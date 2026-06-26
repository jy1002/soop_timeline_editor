# SOOP 타임라인 에디터

SOOP(숲) VOD 다시보기 및 라이브 플레이어 페이지에서 타임스탬프 기반 댓글을 작성·관리하는 Tampermonkey 유저스크립트입니다.

## 지원 사이트

- `vod.sooplive.com` / `vod.sooplive.co.kr` / `vod.afreecatv.com`
- `play.sooplive.com` / `play.sooplive.co.kr` / `play.afreecatv.com`

## 주요 기능

### 타임스탬프 관리
- 현재 재생 시간을 기준으로 타임스탬프 항목 즉시 추가
- 항목별 최대 4단계 들여쓰기(계층 구조) 지원
- 체크박스로 복수 항목 선택 후 시간 일괄 조정 (+1s / -1s / +5s / -5s)
- 정밀 일괄 조정 모달: 시·분·초 단위로 선택 항목 전체 가감

### 다중 페이지 (댓글 분할)
- 댓글 5,000자 제한에 맞춰 페이지를 수동 또는 자동으로 추가
- 페이지 간 이동은 ◀ / ▶ 버튼으로 전환
- 각 페이지는 독립적으로 저장·복사·삭제

### 내보내기 / 가져오기
- 현재 페이지의 타임라인을 댓글용 텍스트로 클립보드에 복사
- 기존 타임라인 텍스트를 붙여넣어 현재 탭에 추가 가져오기

### 단축키 (커스터마이징 가능)
| 단축키 | 기능 |
|---|---|
| `Cmd / Alt` + `Enter` | 타임스탬프 추가 / 편집 완료 |
| `Cmd / Alt` + `Backspace` | 현재 수정 중인 항목 즉시 삭제 |
| `[` / `]` | 선택 항목 ±1초 조정 |
| `{` / `}` | 선택 항목 ±5초 조정 |
| `Tab` / `Shift+Tab` | 들여쓰기 깊이 조절 |
| `Cmd / Alt` + `↑ / ↓` | 목록 맨 위 / 아래로 스크롤 |
| `Shift` + `← / →` | 영상 앞뒤로 탐색 |

- ❓ 버튼에서 모든 단축키 확인 및 개별 변경 가능
- Mac(`Cmd`) / Windows(`Alt`) 자동 감지

### 기타
- 이모지 툴바: 자주 쓰는 이모지를 커서 위치에 즉시 삽입 (커스텀 가능)
- 드래그로 사이드바 위치 자유롭게 이동
- 최소화 버튼으로 사이드바 축소
- 라이브 모드 지원 (방송 시간 기준 타임스탬프 + 오프셋 보정)
- 브라우저 새로고침 후에도 데이터 자동 복원 (`GM_setValue` 영구 저장)

## 가이드 설명서

자세한 사용법은 [구글 슬라이드 가이드](https://docs.google.com/presentation/d/1bpAzflL-AKY8UbbwcNfJ7dRrlbPPNPU8IynM8AC0Ld4/edit?usp=sharing)를 참고하세요.

## 설치

1. 브라우저에 [Tampermonkey](https://www.tampermonkey.net/) 확장 설치
   - 1-1. 브라우저 확장프로그램 설정 → 개발자 모드 ON
   - 1-2. Tampermonkey 확장프로그램 설정 → 유저스크립트 사용 ON
2. [Greasy Fork에서 설치](https://greasyfork.org/ko/scripts/583145-soop-%ED%83%80%EC%9E%84%EB%9D%BC%EC%9D%B8-%EC%97%90%EB%94%94%ED%84%B0) (Tampermonkey 유저스크립트 저장소)
3. SOOP VOD 또는 라이브 플레이어 페이지 접속 시 사이드바 자동 실행
