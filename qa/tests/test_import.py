"""불러오기(가져오기) 기능 테스트"""
import pytest
from playwright.sync_api import Page, expect


IMPORT_BTN = "#tl-btn-import"


def do_import(page: Page, text: str):
    """prompt를 목으로 교체한 뒤 불러오기 버튼 클릭."""
    escaped = text.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
    page.evaluate(f"window.prompt = () => `{escaped}`")
    page.click(IMPORT_BTN)
    page.wait_for_timeout(300)  # render() 완료 대기


def get_rows(page: Page):
    return page.locator(".tl-row")


def get_row_text(page: Page, idx: int) -> str:
    return page.locator(".tl-row").nth(idx).locator(".tl-input").input_value()


def get_row_time(page: Page, idx: int) -> str:
    return page.locator(".tl-row").nth(idx).locator(".tl-time-btn").inner_text()


# ---------- 기본 타임라인 불러오기 ----------

def test_basic_import(clean_page: Page):
    """타임스탬프 형식 줄을 정상적으로 불러온다."""
    do_import(clean_page, "00:01:00 첫 번째\n00:02:00 두 번째")
    expect(get_rows(clean_page)).to_have_count(2)
    assert get_row_time(clean_page, 0) == "00:01:00"
    assert get_row_text(clean_page, 0) == "첫 번째"


# ---------- 연속 텍스트 병합 ----------

def test_consecutive_text_merged(clean_page: Page):
    """연속된 비타임 줄은 하나의 항목으로 병합된다."""
    do_import(clean_page, "텍스트 줄 A\n텍스트 줄 B\n00:01:00 타임라인")
    expect(get_rows(clean_page)).to_have_count(2)
    first_text = get_row_text(clean_page, 0)
    assert "텍스트 줄 A" in first_text
    assert "텍스트 줄 B" in first_text


def test_consecutive_text_newline_separated(clean_page: Page):
    """병합된 텍스트는 줄바꿈(\\n)으로 구분된다."""
    do_import(clean_page, "줄 A\n줄 B\n줄 C\n00:01:00 타임라인")
    text = get_row_text(clean_page, 0)
    assert text == "줄 A\n줄 B\n줄 C"


def test_text_between_timestamps_not_merged(clean_page: Page):
    """타임스탬프 사이의 텍스트는 앞 타임스탬프 직후 별도 항목으로 분리된다."""
    do_import(clean_page, "00:01:00 첫 번째\n중간 텍스트\n00:02:00 두 번째")
    # 첫 번째 + 중간 텍스트 + 두 번째 = 3개
    expect(get_rows(clean_page)).to_have_count(3)


# ---------- 헤더 텍스트(--:--:--) 처리 ----------

def test_header_text_before_first_timestamp(clean_page: Page):
    """첫 타임스탬프 이전 텍스트는 '--:--:--'로 표시되고 맨 앞에 위치한다."""
    do_import(clean_page, "방송 전체 요약 텍스트\n00:00:00 방송 시작")
    expect(get_rows(clean_page)).to_have_count(2)
    assert get_row_time(clean_page, 0) == "--:--:--"
    assert get_row_time(clean_page, 1) == "00:00:00"


def test_header_text_sorts_before_zero(clean_page: Page):
    """--:--:-- 항목은 00:00:00 항목보다 앞에 정렬된다."""
    do_import(clean_page, "요약\n00:00:00 시작\n00:01:00 다음")
    assert get_row_time(clean_page, 0) == "--:--:--"
    assert get_row_time(clean_page, 1) == "00:00:00"
