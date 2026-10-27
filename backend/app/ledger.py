import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Evidence, EvidenceLedger

GENESIS_PREVIOUS_HASH = "0" * 64
LEDGER_HASH_VERSION = 1


def canonical_event(
    *,
    sequence: int,
    block_id: uuid.UUID,
    evidence_id: uuid.UUID,
    previous_hash: str,
    action_type: str,
    actor_id: uuid.UUID,
    file_sha256: str,
    timestamp: datetime,
    metadata: dict[str, Any],
) -> bytes:
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    event = {
        "action_type": action_type,
        "actor_id": str(actor_id),
        "block_id": str(block_id),
        "evidence_id": str(evidence_id),
        "file_sha256_hash": file_sha256,
        "hash_version": LEDGER_HASH_VERSION,
        "metadata": metadata,
        "previous_block_hash": previous_hash,
        "sequence": sequence,
        "timestamp": timestamp.astimezone(timezone.utc).isoformat(timespec="microseconds"),
    }
    return json.dumps(
        event, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")


def calculate_event_hash(**event_fields: Any) -> str:
    return hashlib.sha256(canonical_event(**event_fields)).hexdigest()


def append_event(
    session: Session,
    *,
    evidence: Evidence,
    action_type: str,
    actor_id: uuid.UUID,
    metadata: dict[str, Any] | None = None,
) -> EvidenceLedger:
    session.execute(
        select(Evidence.id).where(Evidence.id == evidence.id).with_for_update()
    ).scalar_one()
    previous = session.scalar(
        select(EvidenceLedger)
        .where(EvidenceLedger.evidence_id == evidence.id)
        .order_by(EvidenceLedger.sequence.desc())
        .limit(1)
    )
    sequence = 1 if previous is None else previous.sequence + 1
    previous_hash = GENESIS_PREVIOUS_HASH if previous is None else previous.current_block_hash
    block_id = uuid.uuid4()
    timestamp = datetime.now(timezone.utc)
    event_metadata = metadata or {}
    event_hash = calculate_event_hash(
        sequence=sequence,
        block_id=block_id,
        evidence_id=evidence.id,
        previous_hash=previous_hash,
        action_type=action_type,
        actor_id=actor_id,
        file_sha256=evidence.file_sha256,
        timestamp=timestamp,
        metadata=event_metadata,
    )
    block = EvidenceLedger(
        block_id=block_id,
        evidence_id=evidence.id,
        sequence=sequence,
        previous_block_hash=previous_hash,
        action_type=action_type,
        actor_id=actor_id,
        file_sha256_hash=evidence.file_sha256,
        metadata_json=event_metadata,
        timestamp=timestamp,
        hash_version=LEDGER_HASH_VERSION,
        current_block_hash=event_hash,
    )
    session.add(block)
    session.flush()
    return block


def verify_chain(blocks: list[EvidenceLedger], evidence_id: uuid.UUID) -> bool:
    previous_hash = GENESIS_PREVIOUS_HASH
    first_digest = blocks[0].file_sha256_hash if blocks else None
    for expected_sequence, block in enumerate(blocks, start=1):
        if (
            block.evidence_id != evidence_id
            or block.sequence != expected_sequence
            or block.previous_block_hash != previous_hash
            or block.hash_version != LEDGER_HASH_VERSION
            or block.file_sha256_hash != first_digest
        ):
            return False
        expected_hash = calculate_event_hash(
            sequence=block.sequence,
            block_id=block.block_id,
            evidence_id=block.evidence_id,
            previous_hash=block.previous_block_hash,
            action_type=block.action_type,
            actor_id=block.actor_id,
            file_sha256=block.file_sha256_hash,
            timestamp=block.timestamp,
            metadata=block.metadata_json,
        )
        if block.current_block_hash != expected_hash:
            return False
        previous_hash = block.current_block_hash
    return bool(blocks) and blocks[0].action_type == "INGEST"
