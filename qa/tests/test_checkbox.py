"""체크박스 선택 및 단축키 연동 테스트"""
import pytest
from playwright.sync_api import Page, expect


def do_import(page: Page, text: str):
    escaped = text.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
    page.evaluate(f"window.prompt = () => `{escaped}`")
    page.click("#tl-btn-import")
    page.wait_for_timeout(300)


def get_row(page: Page, idx: int):
    return page.locator(".tl-row").nth(idx)


def get_time_btn(page: Page, idx: int):
    return get_row(page, idx).locator(".tl-time-btn")


def get_checkbox(page: Page, idx: int):
    return get_row(page, idx).locator(".tl-checkbox")


# ---------- 체크박스 선택 ----------

def test_checkbox_selects_row(clean_page: Page):
    """체크박스 클릭 시 해당 행이 선택 상태(.tl-selected)가 된다."""
    do_import(clean_page, "00:01:00 첫 번째\n00:02:00 두 번째")
    get_checkbox(clean_page, 0).click()
    clean_page.wait_for_timeout(100)
    classes = get_row(clean_page, 0).get_attribute("class")
    assert "tl-selected" in classes


def test_checkbox_deselects_on_second_click(clean_page: Page):
    """체크박스를 두 번 클릭하면 선택이 해제된다."""
    do_import(clean_page, "00:01:00 첫 번째")
    get_checkbox(clean_page, 0).click()
    clean_page.wait_for_timeout(100)
    get_checkbox(clean_page, 0).click()
    clean_page.wait_for_timeout(100)
    classes = get_row(clean_page, 0).get_attribute("class")
    assert "tl-selected" not in classes


# ---------- 체크박스 클릭 후 단축키 동작 ----------

def test_bracket_key_works_after_checkbox(clean_page: Page):
    """체크박스 클릭 후 ] 키로 시간이 +1초 변경된다."""
    do_import(clean_page, "00:01:00 첫 번째")
    get_checkbox(clean_page, 0).click()
    clean_page.wait_for_timeout(100)

    # 체크박스에 포커스가 남아있으면 단축키가 동작하지 않는 버그가 있었음
    clean_page.keyboard.press("]")
    clean_page.wait_for_timeout(500)

    time_text = get_time_btn(clean_page, 0).inner_text()
    assert time_text == "00:01:01", f"예상: 00:01:01, 실제: {time_text}"


def test_bracket_minus_key_works_after_checkbox(clean_page: Page):
    """체크박스 클릭 후 [ 키로 시간이 -1초 변경된다."""
    do_import(clean_page, "00:01:00 첫 번째")
    get_checkbox(clean_page, 0).click()
    clean_page.wait_for_timeout(100)

    clean_page.keyboard.press("[")
    clean_page.wait_for_timeout(500)

    time_text = get_time_btn(clean_page, 0).inner_text()
    assert time_text == "00:00:59", f"예상: 00:00:59, 실제: {time_text}"


def test_no_focus_outline_after_checkbox(clean_page: Page):
    """체크박스 클릭 후 포커스 아웃라인이 사라진다 (outline: none 적용 확인)."""
    do_import(clean_page, "00:01:00 항목")
    cb = get_checkbox(clean_page, 0)
    cb.click()
    clean_page.wait_for_timeout(100)
    # document.activeElement가 checkbox가 아니어야 함 (blur() 호출 확인)
    active = clean_page.evaluate("document.activeElement.tagName")
    assert active != "INPUT", "체크박스 클릭 후 blur()가 호출되지 않았음"
