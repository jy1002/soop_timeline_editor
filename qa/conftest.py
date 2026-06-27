import pytest
from pathlib import Path
from playwright.sync_api import Page, expect


MOCK_PAGE = Path(__file__).parent / "mock-page.html"


@pytest.fixture
def page(page: Page):
    """각 테스트 전에 목 페이지를 열고 스크립트가 초기화될 때까지 대기."""
    page.goto(MOCK_PAGE.as_uri())
    # 사이드바가 DOM에 마운트될 때까지 대기
    page.wait_for_selector("#tl-sidebar", timeout=5000)
    return page


@pytest.fixture
def clean_page(page: Page):
    """GM 스토어를 초기화한 뒤 목 페이지를 새로 로드."""
    page.goto(MOCK_PAGE.as_uri())
    page.wait_for_selector("#tl-sidebar", timeout=5000)
    # 저장된 상태 전부 초기화 후 페이지 재로드
    page.evaluate("window.__GM_clearStore()")
    page.reload()
    page.wait_for_selector("#tl-sidebar", timeout=5000)
    return page
