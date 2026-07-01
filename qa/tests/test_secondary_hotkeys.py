"""보조 단축키(secondary hotkey) 기능 검증"""
import pytest
from playwright.sync_api import Page, expect


def open_help_modal(page: Page):
    page.click("#tl-btn-help")
    page.wait_for_selector("#tl-help-modal", timeout=5000)


def row_for_label(page: Page, label: str):
    return page.locator(f"#tl-hotkey-table-body tr:has-text('{label}')")


def get_rows(page: Page):
    return page.locator(".tl-row")


def test_help_modal_has_primary_and_secondary_columns(clean_page: Page):
    open_help_modal(clean_page)
    headers = clean_page.locator("#tl-help-modal table.tl-help-table").first.locator("th").all_inner_texts()
    assert headers == ["기능 종류", "기본 단축키", "보조 단축키"]


def test_tabdepth_row_not_in_customizable_table(clean_page: Page):
    open_help_modal(clean_page)
    row_in_custom_table = clean_page.locator("#tl-hotkey-table-body tr:has-text('들여쓰기')")
    expect(row_in_custom_table).to_have_count(0)


def test_tabdepth_row_is_in_fixed_table(clean_page: Page):
    open_help_modal(clean_page)
    fixed_table = clean_page.locator("#tl-help-modal table.tl-help-table").nth(1)
    row = fixed_table.locator("tr:has-text('들여쓰기')")
    expect(row).to_have_count(1)
    assert row.locator("button").count() == 0


def test_backspace_delete_shown_in_fixed_table(clean_page: Page):
    open_help_modal(clean_page)
    fixed_table = clean_page.locator("#tl-help-modal table.tl-help-table").nth(1)
    row = fixed_table.locator("tr:has-text('작성 중인 타임라인 라인 즉시 삭제 파괴')")
    expect(row).to_have_count(1)
    assert "Backspace" in row.inner_text()


def test_register_secondary_standalone_key(clean_page: Page):
    open_help_modal(clean_page)
    row = row_for_label(clean_page, "타임스탬프 추가/완료")
    row.locator(".tl-kbd-btn-change").click()
    clean_page.wait_for_timeout(100)
    clean_page.keyboard.press("y")
    clean_page.wait_for_timeout(100)

    kbd = row.locator("kbd").nth(1)  # 0번=기본, 1번=보조
    assert kbd.inner_text().lower() == "y"

    store = clean_page.evaluate("window.__GM_getStore()")
    assert store["soop_global_hotkeys_secondary_v1"]["addTimestamp"]["key"] == "y"


def test_secondary_key_fires_outside_input_but_not_inside(clean_page: Page):
    # 1. 보조 단축키 'y'를 addTimestamp에 등록
    open_help_modal(clean_page)
    row = row_for_label(clean_page, "타임스탬프 추가/완료")
    row.locator(".tl-kbd-btn-change").click()
    clean_page.wait_for_timeout(100)
    clean_page.keyboard.press("y")
    clean_page.click("#tl-help-close-btn")
    clean_page.wait_for_timeout(100)

    # 2. 입력창 밖(body)에서 y -> 타임스탬프 추가되어야 함
    initial_count = get_rows(clean_page).count()
    clean_page.locator("body").click(position={"x": 5, "y": 5})
    clean_page.keyboard.press("y")
    clean_page.wait_for_timeout(300)
    expect(get_rows(clean_page)).to_have_count(initial_count + 1)

    # 3. 텍스트 입력창 안에서 y -> 타이핑만 되어야 함 (행 개수 불변, 텍스트에 y 포함)
    textarea = get_rows(clean_page).first.locator(".tl-input")
    textarea.click()
    clean_page.wait_for_timeout(100)
    count_before_typing = get_rows(clean_page).count()
    textarea.press("y")
    clean_page.wait_for_timeout(200)
    expect(get_rows(clean_page)).to_have_count(count_before_typing)
    assert "y" in textarea.input_value()


def test_clear_secondary_button(clean_page: Page):
    open_help_modal(clean_page)
    row = row_for_label(clean_page, "선택 항목 +1초 가감")
    row.locator(".tl-kbd-btn-change").click()
    clean_page.wait_for_timeout(100)
    clean_page.keyboard.press("p")

    clear_btn = row.locator(".tl-kbd-btn-clear")
    expect(clear_btn).to_be_visible()
    clear_btn.click()
    clean_page.wait_for_timeout(100)

    kbd = row.locator("kbd").nth(1)
    assert kbd.inner_text() == "미설정"
    assert clear_btn.is_hidden()

    store = clean_page.evaluate("window.__GM_getStore()")
    assert "timePlus1" not in store.get("soop_global_hotkeys_secondary_v1", {})


def test_reset_all_secondary_button(clean_page: Page):
    open_help_modal(clean_page)
    row = row_for_label(clean_page, "창 맨 위로 스크롤")
    row.locator(".tl-kbd-btn-change").click()
    clean_page.wait_for_timeout(100)
    clean_page.keyboard.press("g")

    store = clean_page.evaluate("window.__GM_getStore()")
    assert store["soop_global_hotkeys_secondary_v1"]["scrollTop"]["key"] == "g"

    clean_page.on("dialog", lambda d: d.accept())
    clean_page.click("#tl-kbd-btn-reset")
    clean_page.wait_for_timeout(200)

    store_after = clean_page.evaluate("window.__GM_getStore()")
    assert store_after["soop_global_hotkeys_secondary_v1"] == {}

    # primary(기본 단축키)는 초기화 버튼과 무관하게 계속 동작해야 함
    clean_page.click("#tl-help-close-btn")
    initial_count = get_rows(clean_page).count()
    clean_page.keyboard.press("Alt+Enter")
    clean_page.wait_for_timeout(300)
    expect(get_rows(clean_page)).to_have_count(initial_count + 1)


def test_primary_column_has_no_edit_button(clean_page: Page):
    open_help_modal(clean_page)
    row = row_for_label(clean_page, "타임스탬프 추가/완료")
    # 기본 단축키 열(첫 kbd)에는 편집 버튼이 없어야 함 (버튼은 보조 열에 1개만 존재)
    assert row.locator(".tl-kbd-btn-change").count() == 1
    assert row.locator("td").nth(1).locator("button").count() == 0
