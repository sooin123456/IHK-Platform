# DWG 읽기 실행 격리 검증

2026-09-06 · 내부 개발 검증 · 운영 배포 아님

## 구현 범위

기존 ACadSharp 3.7.1 읽기 코드를 재사용해 DWG를 파일 경로 없이 표준 입력으로 전달하고, 별도 Linux 컨테이너에서 읽은 결과만 받는다. 읽기마다 고유 실행 단위를 만들며 원본 파일·서비스 인증정보·Docker 소켓을 처리 컨테이너에 제공하지 않는다. 새 npm/NuGet 의존성이나 별도 상시 변환 서버는 추가하지 않았다.

- 입력 200MiB, 결과 32MiB, 진단·제어 응답 64KiB 제한.
- 실행 최대 120초, 정리 별도 최대 10초. 호스트 연결이 끊겨도 컨테이너 내부 종료 제한이 남는다.
- CPU 1개 분량, 메모리 1GiB와 추가 스왑 불허, 프로세스 64개 제한.
- 비루트 사용자, 읽기 전용 루트, 네트워크 없음, 권한 상승 금지, 모든 capability 제거, 기본 seccomp 필터.
- 추가 작업 공간은 `/tmp` 16MiB 임시 메모리 파일시스템. Docker의 기본 가상 파일시스템과 비공유 64MiB `/dev/shm`은 남고 메모리 제한에 포함된다.
- Docker 실행 프로그램도 매번 별도의 빈 `0700` 설정 디렉터리를 사용한다. 환경 변수만 비우면 사용자 계정 설정을 다시 찾는 Docker의 동작을 차단한다. [공식 Docker CLI 소스](https://raw.githubusercontent.com/docker/cli/master/cli/config/config.go)

컨테이너를 시작하기 전에 실제 이미지·실행 식별자·권한·마운트·자원 설정을 검사한다. 종료 후에는 원본 SHA와 결과 스키마, 정상 종료 여부, 본인 실행 단위의 정리를 확인한다. 컨테이너와 임시 설정 정리를 모두 마친 뒤 취소 여부와 원본 SHA를 다시 검사하고 결과를 반환한다. 생성 응답이 유실돼도 같은 실행 이름만 조회하며, 불확실한 상태에서 새 실행을 만들거나 다른 컨테이너를 지우지 않는다.

## 검증 결과

| 검사 | 확인된 결과 |
| --- | --- |
| Node 회귀·처리 제어·실제 Docker 통합 | 161 통과, 실패·건너뜀 0 |
| 네이티브 읽기·일반 검사 | 28 통과, 실패 0 |
| 기존 네이티브 생성기 검사 | 13 통과, 실패 0 |
| Release 빌드 | 오류·경고 0 |
| 애플리케이션 타입 검사 | exit 0 |

실제 통합 검사 5개는 위 Node 합계에 포함된다. 매번 새 합성 DWG를 만들고 두 번 동시에 읽어 원본 SHA, LINE·CIRCLE·ARC·LWPOLYLINE·TEXT의 값, 네이티브 핸들 `4A`–`4E`, 작업실 객체와 원본 근거 연결을 확인했다. 미지원 INSERT는 지원된 객체로 위장하지 않는다.

실제 프로세스와 커널에서 UID/GID 65532, `NoNewPrivs=1`, `Seccomp=2`, capability 0, 루트 쓰기 거부, `/tmp` 쓰기 허용, loopback만 존재, IPv4 외부 경로 없음, `memory.max=1073741824`, `cpu.max=100000 100000`, `pids.max=64`를 확인했다. 유한한 대기 작업의 내부 제한 종료는 exit 137·비OOM이었다. 손상 DWG와 실행 중 취소는 자기 컨테이너만 정리했고 비교용 컨테이너는 보존했다. 마지막 별도 조회에서도 테스트 컨테이너가 남지 않았다.

고정 이미지 ID는 `sha256:c67ff75cdacccad6cd77b275ad2557f889943bd29c98767c8f0e399d5e9b394f`다. SDK·런타임 베이스는 공식 .NET 8 이미지의 명시적 digest로 고정했다. 현재 환경에는 buildx가 없어 classic builder로 빌드했으며, Dockerfile 전용 ignore가 적용되지 않는 문제를 표준 `.dockerignore` 하나로 수정해 전송 컨텍스트를 6.227MB에서 289.8kB로 줄였다. 런타임 이미지 ID는 동일했다. classic builder의 폐기 예정 경고와 기존 의도적 거부 검사 진단을 숨기지 않는다.

세부 파일·로그 해시와 실행 값은 [최종 검증 기록](2026-09-06-native-dwg-reader-isolation/verification.json)에 보존했다. 최종 합성 원본 SHA는 `dfd667ecb23a46c8838c82f97245d7fd5bf8c1183975169ad4250f6721e447b2`, 파싱된 보고서 해시는 `752226634efae07ce8bb1c738e6f490ff5a28e3f67f2cdf5afe14c8fb22328f3`다. 코드·로그 해시가 최종 실행과 일치하는지 확인한 뒤 기록했다.

개별 구현·수정·전체 변경의 독립 검토와 마지막 수정 재검토가 모두 통과했으며 남은 지적은 없다. 통합 검사의 첫 실제 실행은 통과였으므로 관찰하지 않은 실패→성공 이력을 주장하지 않는다. 종료 정리 중 원본 변경·취소 문제는 두 재현 검사의 실패를 확인하고 수정 후 통과시켰다. 컨테이너 부재 검사는 단순 접속 오류를 부재로 오인하지 않도록 성공한 정확한 이름 조회를 요구하며, 해당 재현 검사도 실패→성공을 확인했다.

## 재현과 남은 연결

저장소 루트에서 기존 로컬 의존성과 Docker/Colima가 준비된 환경을 사용한다. 이 명령은 새 고유 검증 폴더를 생성하며 기존 결과를 덮어쓰지 않는다.

```sh
NATIVE_DWG_DOCKER_PATH=/opt/homebrew/bin/docker NATIVE_DWG_DOCKER_HOST=unix:///Users/h/.colima/default/docker.sock NATIVE_DWG_READER_IMAGE_ID=sha256:c67ff75cdacccad6cd77b275ad2557f889943bd29c98767c8f0e399d5e9b394f node .superpowers/sdd/2026-09-06-native-dwg-reader-isolation/verify.mjs all
```

실제 통합 테스트는 `platform/tests/drawing-native-dwg-sandbox-integration.test.mjs`에 있으며, 세 환경 변수가 없으면 건너뛰지 않고 실패한다. 합성 DWG의 바이너리는 생성 때마다 달라질 수 있어 실행마다 그 원본의 SHA를 계산한다. 결과 해시는 파싱된 보고서의 압축 JSON 직렬화 값이며 원시 전송 바이트 해시와 구분한다.

이번 결과는 신뢰하는 패치된 Docker·Linux arm64·cgroup v2 환경의 내부 검사다. 커널/데몬 취약점 방어 인증, 고객 DWG 전반의 호환성이나 납품 검증이 아니다. `experimental-unqualified`, `persistenceAuthority: not-issued`를 유지한다.

다음 필수 작업은 검증된 업로드 → DWG 가져오기 작업·임대 → 격리 읽기 → 서비스 발급 원본 객체 근거 → 저장·실행 취소·협업·복원 → 로그인 후 실제 UI 연결이다. 이후 승인된 변경의 원본 복사본 재저장과 외부 CAD·수신자 납품 검증이 필요하다. 기존 DXF 근거와 원본 없는 승인 도면의 DWG 내보내기 권한은 변경하지 않았다. 운영 배포·원격 DB 변경은 하지 않았으며 전체 목표는 활성 상태다.
