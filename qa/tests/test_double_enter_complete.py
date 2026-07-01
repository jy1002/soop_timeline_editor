"""타임스탬프 완료 전용: 조합키 없는 Enter 빠른 두 번 입력 시 완료 처리 (고정 동작, 보조 단축키 미지원)"""
from playwright.sync_api import Page


def do_import(page: Page, text: str):
    escaped = text.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
    page.evaluate(f"window.prompt = () => `{escaped}`")
    page.click("#tl-btn-import")
    page.wait_for_timeout(300)


def test_single_enter_still_inserts_newline(clean_page: Page):
    do_import(clean_page, "00:01:00 테스트 항목")
    textarea = clean_page.locator(".tl-row").first.locator(".tl-input")
    textarea.click()
    clean_page.wait_for_timeout(100)
    textarea.press("Enter")
    clean_page.wait_for_timeout(100)
    assert "\n" in textarea.input_value()
    active_tag = clean_page.evaluate("document.activeElement.tagName")
    assert active_tag == "TEXTAREA", "단일 Enter로 포커스가 빠지면 안 됨"


def test_double_enter_within_threshold_completes(clean_page: Page):
    do_import(clean_page, "00:01:00 테스트 항목")
    textarea = clean_page.locator(".tl-row").first.locator(".tl-input")
    textarea.click()
    clean_page.wait_for_timeout(100)
    textarea.press("Enter")
    textarea.press("Enter")  # 빠른 연속 입력
    clean_page.wait_for_timeout(200)
    active_tag = clean_page.evaluate("document.activeElement.tagName")
    assert active_tag != "TEXTAREA", "빠른 Enter 두 번으로 완료(blur)되지 않음"
    # 완료 트리거로 쓰인 첫 Enter의 줄바꿈은 완료 시 텍스트에서 제거되어야 함
    assert textarea.input_value() == "테스트 항목"


def test_double_enter_strips_only_trailing_newline(clean_page: Page):
    """완료 트리거로 생긴 마지막 줄바꿈만 제거하고, 기존 중간 줄바꿈은 보존해야 한다."""
    do_import(clean_page, "00:01:00 첫줄")
    textarea = clean_page.locator(".tl-row").first.locator(".tl-input")
    textarea.click()
    textarea.press("End")
    textarea.type("\n둘째줄")  # 사용자가 명시적으로 넣은 중간 줄바꿈
    clean_page.wait_for_timeout(500)  # 임계값을 넘겨 완료 트리거와 무관한 상태로 리셋
    textarea.press("Enter")
    textarea.press("Enter")
    clean_page.wait_for_timeout(200)
    assert textarea.input_value() == "첫줄\n둘째줄"


def test_slow_double_enter_does_not_complete(clean_page: Page):
    do_import(clean_page, "00:01:00 테스트 항목")
    textarea = clean_page.locator(".tl-row").first.locator(".tl-input")
    textarea.click()
    clean_page.wait_for_timeout(100)
    textarea.press("Enter")
    clean_page.wait_for_timeout(600)  # 임계값(400ms) 초과
    textarea.press("Enter")
    clean_page.wait_for_timeout(100)
    active_tag = clean_page.evaluate("document.activeElement.tagName")
    assert active_tag == "TEXTAREA", "임계값을 넘겨 누른 Enter는 완료로 처리되면 안 됨"
    assert textarea.input_value().count("\n") == 2


def test_double_enter_not_exposed_as_customizable_secondary(clean_page: Page):
    """완료용 더블엔터는 별도 보조 단축키 UI를 노출하지 않아야 한다."""
    clean_page.click("#tl-btn-help")
    clean_page.wait_for_selector("#tl-help-modal")
    row = clean_page.locator("#tl-hotkey-table-body tr:has-text('타임스탬프 추가/완료')")
    # 보조 단축키 편집 버튼은 addTimestamp 기본 항목에 1개만 존재해야 함 (더블엔터용 별도 버튼 없음)
    assert row.locator(".tl-kbd-btn-change").count() == 1


def test_double_enter_is_documented_in_fixed_table(clean_page: Page):
    """더블엔터 완료 동작이 고정 단축키(변경 불가) 표에 설명되어 있어야 한다."""
    clean_page.click("#tl-btn-help")
    clean_page.wait_for_selector("#tl-help-modal")
    fixed_table = clean_page.locator("#tl-help-modal table.tl-help-table").nth(1)
    row = fixed_table.locator("tr:has-text('완료')")
    assert row.count() >= 1
    assert "Enter" in row.first.inner_text()
