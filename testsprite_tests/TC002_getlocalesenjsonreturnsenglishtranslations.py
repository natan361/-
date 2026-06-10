import requests

def test_getlocalesenjsonreturnsenglishtranslations():
    base_url = "http://localhost:3000"
    url = f"{base_url}/locales/en.json"
    timeout = 30
    headers = {
        "Accept": "application/json"
    }

    try:
        response = requests.get(url, headers=headers, timeout=timeout)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        assert False, f"Request failed: {e}"
    
    # Validate response
    assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"
    
    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    # Basic validation for English translation keys expected in the language switcher
    expected_keys = [
        "language_switcher.title",
        "language_switcher.english",
        "language_switcher.hebrew",
        "language_switcher.french"
    ]

    missing_keys = [key for key in expected_keys if key not in data]
    assert not missing_keys, f"Missing expected translation keys: {missing_keys}"

test_getlocalesenjsonreturnsenglishtranslations()
