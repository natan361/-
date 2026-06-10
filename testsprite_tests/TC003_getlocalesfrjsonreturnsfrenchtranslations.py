import requests

def test_get_locales_fr_json_returns_french_translations():
    base_url = "http://localhost:3000/he"
    url = base_url.replace("/he", "/locales/fr.json")
    timeout = 30
    try:
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    # Validate response status
    assert response.status_code == 200

    # Validate content-type header for JSON
    content_type = response.headers.get('Content-Type', '')
    assert 'application/json' in content_type, f"Unexpected Content-Type: {content_type}"

    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not a valid JSON"

    # Basic validation for French locale keys expected in translations for language switcher
    expected_keys = [
        "hebrew", "english", "french",
        "welcome_message", "contact_us", "get_a_quote"
    ]

    for key in expected_keys:
        assert key in data, f"Missing expected translation key: '{key}'"
        assert isinstance(data[key], str), f"Translation for key '{key}' is not a string"


# Run the test

test_get_locales_fr_json_returns_french_translations()
