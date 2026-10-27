import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.ledger import GENESIS_PREVIOUS_HASH, calculate_event_hash, verify_chain


def make_block(
    *,
    sequence: int,
    evidence_id: uuid.UUID,
    previous_hash: str,
    action: str,
    file_hash: str,
    metadata: dict,
):
    block_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    timestamp = datetime(2026, 1, 1, 12, sequence, tzinfo=timezone.utc)
    block_hash = calculate_event_hash(
        sequence=sequence,
        block_id=block_id,
        evidence_id=evidence_id,
        previous_hash=previous_hash,
        action_type=action,
        actor_id=actor_id,
        file_sha256=file_hash,
        timestamp=timestamp,
        metadata=metadata,
    )
    return SimpleNamespace(
        sequence=sequence,
        block_id=block_id,
        evidence_id=evidence_id,
        previous_block_hash=previous_hash,
        action_type=action,
        actor_id=actor_id,
        file_sha256_hash=file_hash,
        timestamp=timestamp,
        metadata_json=metadata,
        hash_version=1,
        current_block_hash=block_hash,
    )


def test_valid_chain_passes_and_modified_event_fails():
    evidence_id = uuid.uuid4()
    digest = "a" * 64
    genesis = make_block(
        sequence=1,
        evidence_id=evidence_id,
        previous_hash=GENESIS_PREVIOUS_HASH,
        action="INGEST",
        file_hash=digest,
        metadata={"source": "test"},
    )
    verification = make_block(
        sequence=2,
        evidence_id=evidence_id,
        previous_hash=genesis.current_block_hash,
        action="VERIFY",
        file_hash=digest,
        metadata={"result": "PASS"},
    )

    assert verify_chain([genesis, verification], evidence_id)
    verification.metadata_json["result"] = "FAIL"
    assert not verify_chain([genesis, verification], evidence_id)


def test_chain_rejects_missing_or_reordered_events():
    evidence_id = uuid.uuid4()
    genesis = make_block(
        sequence=1,
        evidence_id=evidence_id,
        previous_hash=GENESIS_PREVIOUS_HASH,
        action="INGEST",
        file_hash="b" * 64,
        metadata={},
    )
    second = make_block(
        sequence=2,
        evidence_id=evidence_id,
        previous_hash=genesis.current_block_hash,
        action="VIEW",
        file_hash="b" * 64,
        metadata={},
    )

    assert not verify_chain([second], evidence_id)
    assert not verify_chain([second, genesis], evidence_id)
