"""보조 단축키로 조합키 없는 일반 텍스트 단일 키를 등록하면 충돌 경고 팝업이 뜬다"""
from playwright.sync_api import Page, expect


def open_help_modal(page: Page):
    page.click("#tl-btn-help")
    page.wait_for_selector("#tl-help-modal", timeout=5000)


def row_for_label(page: Page, label: str):
    return page.locator(f"#tl-hotkey-table-body tr:has-text('{label}')")


def test_plain_letter_secondary_shows_collision_warning(clean_page: Page):
    open_help_modal(clean_page)
    row = row_for_label(clean_page, "선택 항목 -1초 가감")
    row.locator(".tl-kbd-btn-change").click()
    clean_page.wait_for_timeout(100)
    clean_page.keyboard.press("f")
    clean_page.wait_for_timeout(150)

    notice = clean_page.locator("#tl-notice-modal")
    expect(notice).to_be_visible()
    text = notice.inner_text()
    assert "SOOP 자체 혹은 브라우저 자체 단축키와 겹칠 수 있습니다" in text
    assert "F >" in text and "M >" in text


def test_collision_warning_dismisses_on_any_key(clean_page: Page):
    open_help_modal(clean_page)
    row = row_for_label(clean_page, "선택 항목 +1초 가감")
    row.locator(".tl-kbd-btn-change").click()
    clean_page.wait_for_timeout(100)
    clean_page.keyboard.press("m")
    clean_page.wait_for_timeout(150)

    notice = clean_page.locator("#tl-notice-modal")
    expect(notice).to_be_visible()
    clean_page.keyboard.press("q")  # 아무 키나 눌러서 닫기
    expect(notice).to_be_hidden()


def test_shift_letter_secondary_does_not_warn(clean_page: Page):
    """요구사항은 '조합키 없는' 일반 텍스트 단일 키만 대상이므로, Shift+문자는 경고 대상에서 제외된다."""
    open_help_modal(clean_page)
    row = row_for_label(clean_page, "선택 항목 -5초 대폭 가감")
    row.locator(".tl-kbd-btn-change").click()
    clean_page.wait_for_timeout(100)
    clean_page.keyboard.press("Shift+Q")
    clean_page.wait_for_timeout(150)
    # 요구사항은 "조합키 없는" 일반 텍스트 단일 키만을 대상으로 하므로 Shift 조합은 경고가 뜨지 않아야 한다
    expect(clean_page.locator("#tl-notice-modal")).to_be_hidden()


def test_symbol_or_special_key_secondary_does_not_warn(clean_page: Page):
    open_help_modal(clean_page)
    row = row_for_label(clean_page, "창 맨 아래로 스크롤")
    row.locator(".tl-kbd-btn-change").click()
    clean_page.wait_for_timeout(100)
    clean_page.keyboard.press("Alt+q")  # 조합키가 있는 경우
    clean_page.wait_for_timeout(150)
    expect(clean_page.locator("#tl-notice-modal")).to_be_hidden()
