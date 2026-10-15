# API 호출 지도 (api-catalog.json)

QA 페이지의 **API 호출 지도** 탭 데이터. 앱이 어느 씬에서, 어떤 상황에 어떤 서버 API 를 부르는지 정리한다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `extract_api.py` | Unity 프로젝트를 정적으로 훑어 `CommonAPI.cs` 의 API 정의, `Api.Get<API_X>().Y` 호출 지점, 스크립트가 붙은 씬·프리팹을 뽑는다 (약 1분) |
| `descriptions.json` | 엔드포인트별 이름·설명과 호출 지점별 씬·화면·상황·실패 처리. **사람이 읽고 쓴 내용이라 자동 생성되지 않는다** |
| `build_catalog.py` | 위 둘을 합쳐 저장소 루트의 `api-catalog.json` 을 만든다. 줄 번호는 최신 코드 기준으로 갱신 |

## 갱신

```
cd tools/api_catalog
python -I extract_api.py C:\Users\math_18\Documents\UnityProjects\onepromath_v3g raw.json
python -I build_catalog.py raw.json descriptions.json C:\Users\math_18\Documents\UnityProjects\onepromath_v3g ..\..\api-catalog.json
```

`build_catalog.py` 가 출력하는 경고를 보고 `descriptions.json` 을 고친다.

- `[설명 없음]` — 새로 생긴 호출 지점. 페이지에 "(설명 없음 — 새 호출 지점)" 으로 나온다. 코드를 읽고 설명을 채운다.
- `[사라짐]` — 설명에 적힌 파일이 프로젝트에서 없어진 경우. 페이지에서는 빠진다. `descriptions.json` 에서도 지운다.
  (공용 메서드를 거쳐 부르는 상위 화면처럼 추출 패턴에 안 걸리는 호출 지점은 파일이 남아 있으면 그대로 유지된다 — 줄 번호는 자동 갱신 안 됨)
- `[엔드포인트 설명 없음]` — `CommonAPI.cs` 에 새 API 가 추가됨.

`raw.json` 은 중간 산출물이라 커밋하지 않는다.

## 한계

- 호출 지점은 `Api.Get<API_X>()` 패턴만 잡는다. URL 을 직접 문자열로 만들거나 `UnityWebRequest` 를 따로 쓰는 곳은 빠진다.
- WebSocket(`WS.*`) 은 추출 대상이 아니라 `descriptions.json` 에 손으로 적은 것만 나온다.
- 씬은 스크립트·프리팹 참조로 1차 추정하고, Addressables 로 띄우는 팝업은 호출 체인을 읽어 사람이 적었다.
