from app.density_estimate import parse_density_estimates
from app.fireworks_llm import LLMError
import pytest


def test_parse_density_estimates_reads_json_payload():
    estimates = parse_density_estimates(
        '{"estimates":[{"name":"rye flour","density_kg_m3":500},{"name":"brisket","density_kg_m3":null}]}',
        ["rye flour", "brisket"],
    )

    assert estimates[0].name == "rye flour"
    assert estimates[0].density_kg_m3 == 500
    assert estimates[1].name == "brisket"
    assert estimates[1].density_kg_m3 is None


def test_parse_density_estimates_rounds_and_rejects_out_of_range():
    estimates = parse_density_estimates(
        '{"estimates":[{"name":"honey","density_kg_m3":1424},{"name":"lead","density_kg_m3":11340}]}',
        ["honey", "lead"],
    )

    assert estimates[0].density_kg_m3 == 1420
    assert estimates[1].density_kg_m3 is None


def test_parse_density_estimates_accepts_fenced_json():
    estimates = parse_density_estimates(
        '```json\n{"estimates":[{"name":"cocoa powder","density_kg_m3":500}]}\n```',
        ["cocoa powder"],
    )

    assert estimates[0].density_kg_m3 == 500


def test_parse_density_estimates_rejects_invalid_payload():
    with pytest.raises(LLMError, match="not valid JSON"):
        parse_density_estimates("not json", ["flour"])
