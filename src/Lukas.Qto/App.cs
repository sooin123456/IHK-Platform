using System;
using System.Reflection;
using Autodesk.Revit.UI;

namespace Lukas.Qto
{
    /// <summary>
    /// 애드인 진입점. Revit 시작 시 리본 탭과 버튼을 만든다.
    /// .addin 매니페스트의 FullClassName이 이 클래스를 가리킨다.
    /// </summary>
    public class App : IExternalApplication
    {
        private const string TabName = "한길시스템";
        private const string PanelName = "BIM 물량·적산";

        public Result OnStartup(UIControlledApplication application)
        {
            try
            {
                // 같은 이름의 탭이 이미 있으면 예외가 나므로 삼킨다.
                try { application.CreateRibbonTab(TabName); }
                catch (Autodesk.Revit.Exceptions.ArgumentException) { }

                RibbonPanel panel = application.CreateRibbonPanel(TabName, PanelName);
                string assemblyPath = Assembly.GetExecutingAssembly().Location;

                var extractButton = new PushButtonData(
                    "Lukas_Qto_Extract",
                    "수량 산출",
                    assemblyPath,
                    "Lukas.Qto.Commands.ExtractQuantitiesCommand")
                {
                    ToolTip = "현재 모델의 모델 요소를 분류·타입별로 집계하여 CSV로 내보냅니다.",
                    LongDescription =
                        "카테고리와 패밀리 타입 단위로 개수, 체적(m3), 면적(m2), 길이(m)를 집계합니다. " +
                        "산출 결과는 내역서 대조(검산)의 입력으로 사용됩니다."
                };

                panel.AddItem(extractButton);

                panel.AddItem(new PushButtonData(
                    "Lukas_Qto_ExportProperties",
                    "Properties\n추출",
                    assemblyPath,
                    "Lukas.Qto.Commands.ExportElementPropertiesCommand")
                {
                    ToolTip = "요소별 이름, 체적, 길이, 높이와 원본 파라미터를 CSV로 내보냅니다.",
                    LongDescription = "요소 하나당 한 행을 기록합니다. 체적(m3), 길이(m), 높이(m)는 각각 COMPUTED, ZERO, MISSING 상태와 선택된 Revit 내장 파라미터를 함께 남깁니다."
                });

                var packageButton = new PushButtonData(
                    "Lukas_Qto_ExportPackage",
                    "IFC·QTO\n내보내기",
                    assemblyPath,
                    "Lukas.Qto.Commands.ExportIfcQtoPackageCommand")
                {
                    ToolTip = "현재 문서에서 IFC, QTO CSV, 해시 manifest를 하나의 패키지로 만듭니다.",
                    LongDescription =
                        "IFC와 QTO를 같은 문서 상태에서 생성하고 SHA-256을 기록합니다. " +
                        "세 파일이 모두 검증된 경우에만 완료 폴더가 만들어집니다."
                };

                panel.AddItem(packageButton);

                panel.AddItem(new PushButtonData(
                    "Lukas_Qto_OpenDesktop",
                    "검산기\n열기",
                    assemblyPath,
                    "Lukas.Qto.Commands.OpenDesktopCommand")
                {
                    ToolTip = "설치된 한길시스템 검산기를 엽니다.",
                    LongDescription = "내역 검산, 콘크리트·거푸집·철근 산출과 이전 결과 비교는 별도 로컬 검산기에서 실행합니다."
                });

                panel.AddItem(new PushButtonData("Lukas_Qto_ExportFormworkFaces", "거푸집 Face\n원장", assemblyPath, "Lukas.Qto.Commands.ExportFormworkFaceLedgerCommand")
                {
                    ToolTip = "Solid face 면적·식별자·경계 미확정 상태를 별도 원장으로 내보냅니다.",
                    LongDescription = "일반 AreaM2를 재사용하지 않습니다. 콘크리트 접촉, 개구부, 공제, 재질·방향은 자동 추정하지 않아 승인 전 모두 REVIEW입니다."
                });

                var ifcButton = new PushButtonData(
                    "Lukas_Qto_ExportIfc",
                    "IFC 내보내기",
                    assemblyPath,
                    "Lukas.Qto.Commands.ExportIfcCommand")
                {
                    ToolTip = "현재 Revit 문서를 IFC 파일로 내보냅니다.",
                    LongDescription =
                        "저장할 IFC 파일 경로를 선택하면 Revit의 기본 IFC 내보내기 설정으로 현재 문서를 내보냅니다."
                };

                panel.AddItem(ifcButton);
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                TaskDialog.Show("한길시스템", "애드인 초기화 실패:\n" + ex.Message);
                return Result.Failed;
            }
        }

        public Result OnShutdown(UIControlledApplication application)
        {
            return Result.Succeeded;
        }
    }
}
