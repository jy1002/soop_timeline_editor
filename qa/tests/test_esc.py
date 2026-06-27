"""ESC 한 번으로 텍스트 편집 완료 테스트"""
import pytest
from playwright.sync_api import Page, expect


def do_import(page: Page, text: str):
    escaped = text.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
    page.evaluate(f"window.prompt = () => `{escaped}`")
    page.click("#tl-btn-import")
    page.wait_for_timeout(300)


def test_esc_exits_focus_in_one_press(clean_page: Page):
    """textarea에서 ESC 한 번으로 포커스가 해제된다."""
    do_import(clean_page, "00:01:00 테스트 항목")
    textarea = clean_page.locator(".tl-row").first.locator(".tl-input")
    textarea.click()
    clean_page.wait_for_timeout(100)

    # tl-focused 클래스가 있는 상태에서 ESC
    assert "tl-focused" in clean_page.locator(".tl-row").first.get_attribute("class")

    clean_page.keyboard.press("Escape")
    clean_page.wait_for_timeout(200)

    # ESC 한 번 후 포커스가 textarea에 없어야 함
    active_tag = clean_page.evaluate("document.activeElement.tagName")
    assert active_tag != "TEXTAREA", "ESC 한 번으로 textarea 포커스가 해제되지 않았음"


def test_esc_removes_tl_focused_class(clean_page: Page):
    """ESC 후 .tl-focused 클래스가 제거된다."""
    do_import(clean_page, "00:01:00 항목")
    textarea = clean_page.locator(".tl-row").first.locator(".tl-input")
    textarea.click()
    clean_page.wait_for_timeout(100)

    clean_page.keyboard.press("Escape")
    clean_page.wait_for_timeout(200)

    classes = clean_page.locator(".tl-row").first.get_attribute("class")
    assert "tl-focused" not in classes, ".tl-focused 클래스가 ESC 후에도 남아있음"
