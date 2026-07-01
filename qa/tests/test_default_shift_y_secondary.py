"""기본 보조 단축키: 신규 타임라인=y, 신규 텍스트 타임라인=Shift+Y (입력 중에는 타이핑 우선)"""
from playwright.sync_api import Page, expect


def do_import(page: Page, text: str):
    page.evaluate(f"window.prompt = () => `{text}`")
    page.click("#tl-btn-import")
    page.wait_for_timeout(300)


def test_shift_y_creates_text_timestamp_outside_input(clean_page: Page):
    initial = clean_page.locator(".tl-row").count()
    clean_page.locator("body").click(position={"x": 5, "y": 5})
    clean_page.keyboard.press("Shift+Y")
    clean_page.wait_for_timeout(300)
    expect(clean_page.locator(".tl-row")).to_have_count(initial + 1)


def test_shift_y_inside_textarea_just_types_capital_y(clean_page: Page):
    """Shift+Y가 보조 단축키로 등록돼 있어도 입력 중에는 대문자 Y 타이핑이 우선한다."""
    do_import(clean_page, "00:01:00 abc")
    textarea = clean_page.locator(".tl-row").first.locator(".tl-input")
    textarea.click()
    textarea.press("End")
    count_before = clean_page.locator(".tl-row").count()
    textarea.press("Shift+Y")
    clean_page.wait_for_timeout(200)
    assert textarea.input_value() == "abcY"
    assert clean_page.locator(".tl-row").count() == count_before


def test_default_secondary_shown_in_help_modal(clean_page: Page):
    clean_page.click("#tl-btn-help")
    clean_page.wait_for_selector("#tl-help-modal")
    row = clean_page.locator("#tl-hotkey-table-body tr:has-text('텍스트 타임스탬프 추가')")
    text = row.locator("kbd").nth(1).inner_text()
    assert "shift" in text.lower() and "y" in text.lower()
