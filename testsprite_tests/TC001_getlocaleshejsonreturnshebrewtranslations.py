import requests

def test_get_locales_he_json_returns_hebrew_translations():
    url = "http://localhost:3000/locales/he.json"
    headers = {
        "Accept": "application/json"
    }
    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    # Validate content-type header
    content_type = response.headers.get("Content-Type", "")
    assert "application/json" in content_type, f"Expected Content-Type to include 'application/json' but got '{content_type}'"

    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    # Assert response JSON is not empty
    assert data, "Response JSON is empty"

    # Additional Hebrew text checks to confirm it returns Hebrew translations (basic heuristic)
    hebrew_samples = [
        "עברית",  # Hebrew word for Hebrew
        "שפה",    # "Language"
        "החלפה"   # "Switch" or "Change"
    ]
    combined_text = " ".join(str(v) for v in data.values())
    contains_hebrew = any(sample in combined_text for sample in hebrew_samples)
    assert contains_hebrew, "Response JSON does not appear to contain Hebrew text samples"

test_get_locales_he_json_returns_hebrew_translations()
