# Revit 스텁 컴파일 검증

실제 Autodesk DLL 없이 조건부 컴파일 오류를 먼저 찾기 위한 테스트다. 스텁 DLL은 배포물에 포함하거나 실제 Revit 검증을 대체하면 안 된다. `-p:IsRevitStubBuild=true`인 애드인 산출물은 `build/stub/<Configuration>/<버전>`에 격리되어 `install.bat`이 설치하지 않는다. `RevitStubVersion=2017`은 최신 `ForgeTypeId`·`UnitTypeId`를 아예 제공하지 않아, 2017 코드가 실수로 최신 API에 의존하면 컴파일에서 실패한다.

```sh
dotnet build tests/RevitApiStub/UI/RevitAPIUI.csproj -c Release
dotnet run --project tests/THEKIE.Qto.RevitStubTest -c Release
tests/run-revit-stubs.sh
```

마지막 스크립트는 2017·2022~2026을 순서대로 각각 빌드한 직후 해당 DLL을 실행해, 버전별 조건부 중간 산출물이 섞이지 않는 회귀까지 확인한다.

2017 및 2022~2026 조건부 코드를 점검할 때는 다음처럼 실행한다. `TargetFramework=net8.0`은 macOS에서 조건부 소스만 검사하기 위한 값이다.

```sh
stub_dir="$PWD/tests/RevitApiStub/bin/Release/2017/netstandard2.0"
dotnet restore src/THEKIE.Qto/THEKIE.Qto.csproj -p:RevitVersion=2017 -p:TargetFramework=net8.0
dotnet build tests/RevitApiStub/UI/RevitAPIUI.csproj -c Release -p:RevitStubVersion=2017
dotnet build src/THEKIE.Qto/THEKIE.Qto.csproj -c Release -p:IsRevitStubBuild=true -p:RevitApiDir="$stub_dir" -p:RevitVersion=2017 -p:TargetFramework=net8.0 --no-restore
dotnet run --project tests/THEKIE.Qto.RevitStubTest -c Release -p:RevitStubVersion=2017
```

`RevitVersion`과 `RevitStubVersion`, `stub_dir`의 버전 디렉터리를 2022, 2023, 2024, 2025, 2026으로 함께 바꾸어 각각 반복한다. 버전별 `bin/obj`가 분리되므로 순차 실행이나 병렬 에이전트 실행에서도 다른 Revit API 모양이 섞이지 않는다.

검증 범위:

- 2017·2022·2023의 `ElementId.IntegerValue` 분기
- 2017의 `DisplayUnitType` 단위 변환 분기 (최신 단위 타입 미제공 스텁)
- 2024~2026의 `ElementId.Value` 분기
- 수량 집계, 그룹화, 요소ID 보존, 단위 변환 호출 경로

실제 Revit API의 파라미터 존재 여부, 컬렉터 범위, 리본 로딩, 설치와 실제 단위값은 Windows/Revit에서 별도 검증해야 한다.

2017의 실제 `net46` 링크는 다음처럼 검증한다. 결과 DLL은 운영용이 아니며 `build/stub/Release/2017`에만 생성된다.

```sh
dotnet restore tests/RevitApiStub/UI/RevitAPIUI.csproj -p:RevitStubVersion=2017 -p:StubTargetFramework=net46
dotnet build tests/RevitApiStub/UI/RevitAPIUI.csproj -c Release -p:RevitStubVersion=2017 -p:StubTargetFramework=net46 --no-restore
stub_dir="$PWD/tests/RevitApiStub/bin/Release/2017/net46"
dotnet restore src/THEKIE.Qto/THEKIE.Qto.csproj -p:IsRevitStubBuild=true -p:RevitVersion=2017 -p:RevitApiDir="$stub_dir"
dotnet build src/THEKIE.Qto/THEKIE.Qto.csproj -c Release -p:IsRevitStubBuild=true -p:RevitVersion=2017 -p:RevitApiDir="$stub_dir" --no-restore
```
