using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using THEKIE.Qto.Core;

namespace Lukas.Qto.Desktop;

public partial class MainWindow : Window
{
    private DesktopPreflightResult? lastResult;

    public MainWindow()
    {
        InitializeComponent();
        ReportBox.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "LukasQto", "report_" + DateTime.Now.ToString("yyyyMMdd_HHmmss", CultureInfo.InvariantCulture) + ".csv");
    }

    private static string? SelectFile(string filter)
    {
        var dialog = new OpenFileDialog { Filter = filter, CheckFileExists = true };
        return dialog.ShowDialog() == true ? dialog.FileName : null;
    }

    private void BrowseSourceManifest(object sender, RoutedEventArgs e) => Set(SourceManifestBox, SelectFile("소스 매니페스트 (CSV)|*.csv|모든 파일|*.*"));
    private void BrowseExportManifest(object sender, RoutedEventArgs e)
    {
        string? path = SelectFile("Revit export-manifest.csv|export-manifest.csv|CSV|*.csv");
        if (string.IsNullOrEmpty(path)) return;
        ExportManifestBox.Text = path;
        string folder = Path.GetDirectoryName(path)!;
        Set(IfcBox, File.Exists(Path.Combine(folder, "model.ifc")) ? Path.Combine(folder, "model.ifc") : null);
        Set(QtoBox, File.Exists(Path.Combine(folder, "qto.csv")) ? Path.Combine(folder, "qto.csv") : null);
    }
    private void BrowseIfc(object sender, RoutedEventArgs e) => Set(IfcBox, SelectFile("IFC 모델 (*.ifc)|*.ifc|모든 파일|*.*"));
    private void BrowseQto(object sender, RoutedEventArgs e) => Set(QtoBox, SelectFile("QTO (CSV)|*.csv|모든 파일|*.*"));
    private void BrowseEstimate(object sender, RoutedEventArgs e) => Set(EstimateBox, SelectFile("내역서 (CSV, XLSX)|*.csv;*.xlsx|모든 파일|*.*"));
    private void BrowseMapping(object sender, RoutedEventArgs e) => Set(MappingBox, SelectFile("승인 매핑 (CSV, XLSX)|*.csv;*.xlsx|모든 파일|*.*"));
    private void BrowseConcreteMapping(object sender, RoutedEventArgs e) => Set(ConcreteMappingBox, SelectFile("Revit 콘크리트 매핑 (CSV)|*.csv|모든 파일|*.*"));
    private void BrowseConcreteRules(object sender, RoutedEventArgs e) => Set(ConcreteRulesBox, SelectFile("콘크리트 규칙 (CSV)|*.csv|모든 파일|*.*"));
    private void BrowseConcreteRegistry(object sender, RoutedEventArgs e) => Set(ConcreteRegistryBox, SelectFile("콘크리트 승인표 (CSV)|*.csv|모든 파일|*.*"));
    private void BrowseRebarLength(object sender, RoutedEventArgs e) => Set(RebarLengthBox, SelectFile("철근 길이 ledger (CSV)|*.csv|모든 파일|*.*"));
    private void BrowseRebarRules(object sender, RoutedEventArgs e) => Set(RebarRulesBox, SelectFile("철근 규칙 (CSV)|*.csv|모든 파일|*.*"));
    private void BrowseRebarOfficial(object sender, RoutedEventArgs e) => Set(RebarOfficialBox, SelectFile("독립 공식 kg target (CSV)|*.csv|모든 파일|*.*"));
    private void BrowseRebarRegistry(object sender, RoutedEventArgs e) => Set(RebarRegistryBox, SelectFile("철근 승인표 (CSV)|*.csv|모든 파일|*.*"));
    private void BrowseFormworkLedger(object sender, RoutedEventArgs e) => Set(FormworkLedgerBox, SelectFile("Revit 거푸집 Face 원장 (CSV)|formwork-face-ledger.csv|CSV|*.csv"));
    private void BrowseFormworkApproval(object sender, RoutedEventArgs e) => Set(FormworkApprovalBox, SelectFile("거푸집 사용자 승인 CSV|*.csv|모든 파일|*.*"));
    private void BrowseFormworkRegistry(object sender, RoutedEventArgs e) => Set(FormworkRegistryBox, SelectFile("거푸집 관리자 승인표 (CSV)|*.csv|모든 파일|*.*"));
    private void BrowsePreviousReport(object sender, RoutedEventArgs e) => Set(PreviousReportBox, SelectFile("이전 검산 결과 (CSV)|*.csv|모든 파일|*.*"));

    private void BrowseReport(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog { Filter = "검산 결과 (CSV)|*.csv", FileName = Path.GetFileName(ReportBox.Text), OverwritePrompt = true };
        if (dialog.ShowDialog() == true) ReportBox.Text = dialog.FileName;
    }

    private static void Set(TextBox box, string? path)
    {
        if (!string.IsNullOrEmpty(path)) box.Text = path;
    }

    private async void CreateProject(object sender, RoutedEventArgs e)
    {
        try
        {
            string packageName = string.IsNullOrWhiteSpace(ExportManifestBox.Text)
                ? "LukasQto_project"
                : Path.GetFileName(Path.GetDirectoryName(ExportManifestBox.Text)) + "_project";
            var dialog = new SaveFileDialog
            {
                Filter = "Lukas QTO 프로젝트 위치 (*.lukasqto)|*.lukasqto",
                FileName = packageName + ".lukasqto",
                Title = "새 프로젝트 폴더 이름 선택",
                OverwritePrompt = true
            };
            if (dialog.ShowDialog() != true) return;

            string outputDirectory = Path.Combine(Path.GetDirectoryName(dialog.FileName)!, Path.GetFileNameWithoutExtension(dialog.FileName));
            CreateProjectButton.IsEnabled = false;
            StatusText.Text = "내보내기 해시를 확인하고 프로젝트를 만들고 있습니다...";
            ProjectCreationResult project = await Task.Run(() => ProjectManifestBuilder.Create(
                ExportManifestBox.Text, EstimateBox.Text, MappingBox.Text, outputDirectory));
            SourceManifestBox.Text = project.SourceManifestPath;
            IfcBox.Text = project.IfcPath;
            QtoBox.Text = project.QtoPath;
            EstimateBox.Text = project.EstimatePath;
            MappingBox.Text = project.MappingPath;
            StatusText.Text = "프로젝트 생성 완료 · 검산 실행을 누르십시오.";
        }
        catch (Exception ex)
        {
            StatusText.Text = "프로젝트를 만들지 못했습니다.";
            MessageBox.Show(this, ex.Message, "Lukas QTO 검산기", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            CreateProjectButton.IsEnabled = true;
        }
    }

    private async void RegisterEstimateRevision(object sender, RoutedEventArgs e) => await RegisterRevision("estimate", EstimateBox);
    private async void RegisterMappingRevision(object sender, RoutedEventArgs e) => await RegisterRevision("mapping", MappingBox);

    private async Task RegisterRevision(string slot, TextBox currentBox)
    {
        try
        {
            string label = slot == "estimate" ? "내역서" : "승인 매핑";
            string? replacement = SelectFile(label + " 새 개정 (CSV, XLSX)|*.csv;*.xlsx|모든 파일|*.*");
            if (string.IsNullOrEmpty(replacement)) return;
            if (string.IsNullOrWhiteSpace(SourceManifestBox.Text) || string.IsNullOrWhiteSpace(currentBox.Text))
                throw new InvalidOperationException("먼저 현재 소스 매니페스트와 ACTIVE " + label + " 파일을 선택하십시오.");

            RegisterEstimateRevisionButton.IsEnabled = false;
            RegisterMappingRevisionButton.IsEnabled = false;
            StatusText.Text = label + " 새 개정을 프로젝트에 등록하고 있습니다...";
            RevisionRegistrationResult result = await Task.Run(() => RevisionRegistration.Register(new RevisionRegistrationRequest
            {
                SourceManifestPath = SourceManifestBox.Text,
                CurrentActivePath = currentBox.Text,
                ReplacementPath = replacement,
                Slot = slot
            }));
            SourceManifestBox.Text = result.SourceManifestPath;
            currentBox.Text = result.RegisteredFilePath;
            StatusText.Text = label + " r" + result.Revision + " 등록 완료 · 새 source-manifest를 선택했습니다.";
        }
        catch (Exception ex)
        {
            StatusText.Text = "새 개정을 등록하지 못했습니다.";
            MessageBox.Show(this, ex.Message, "Lukas QTO 검산기", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            RegisterEstimateRevisionButton.IsEnabled = true;
            RegisterMappingRevisionButton.IsEnabled = true;
        }
    }

    private async void RunPreflight(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!decimal.TryParse(QuantityToleranceBox.Text, NumberStyles.Number, CultureInfo.InvariantCulture, out decimal quantityTolerance) ||
                !decimal.TryParse(KrwToleranceBox.Text, NumberStyles.Number, CultureInfo.InvariantCulture, out decimal krwTolerance))
                throw new FormatException("허용오차는 0 이상의 숫자로 입력하십시오. 소수점은 '.'을 사용합니다.");

            RunButton.IsEnabled = false;
            StatusText.Text = "소스 게이트와 검산 규칙을 실행하고 있습니다...";
            var request = new DesktopPreflightRequest
            {
                SourceManifestPath = SourceManifestBox.Text,
                IfcPath = IfcBox.Text,
                QtoPath = QtoBox.Text,
                EstimatePath = EstimateBox.Text,
                MappingPath = MappingBox.Text,
                ReportPath = ReportBox.Text,
                QuantityTolerance = quantityTolerance,
                KrwTolerance = krwTolerance
            };
            lastResult = await Task.Run(() => DesktopPreflightRunner.Run(request));
            FindingsGrid.ItemsSource = lastResult.Findings;
            FindingsGrid.SelectedIndex = lastResult.Findings.Count > 0 ? 0 : -1;
            ComparisonGrid.ItemsSource = null;
            if (!string.IsNullOrWhiteSpace(PreviousReportBox.Text))
            {
                string previousReport = Path.GetFullPath(PreviousReportBox.Text);
                string previousManifest = previousReport + ".manifest.csv";
                string comparisonPath = lastResult.ReportPath + ".comparison.csv";
                RunComparisonResult comparison = await Task.Run(() => RunComparer.Compare(new RunComparisonRequest
                {
                    PreviousReportPath = previousReport,
                    PreviousManifestPath = previousManifest,
                    CurrentReportPath = lastResult.ReportPath,
                    CurrentManifestPath = lastResult.ManifestPath,
                    OutputPath = comparisonPath
                }));
                ComparisonGrid.ItemsSource = comparison.Rows;
                int resolved = comparison.Rows.Count(x => x.Status == "RESOLVED");
                int newFailures = comparison.Rows.Count(x => x.Status == "NEW_FAIL");
                int continuing = comparison.Rows.Count(x => x.Status == "UNCHANGED_FAIL");
                int comparisonReview = comparison.Rows.Count(x => x.Status is "CONDITION_CHANGED" or "REVIEW_DUPLICATE" or "NOT_COMPARABLE");
                ComparisonStatusText.Text = $"해결 {resolved} · 신규 실패 {newFailures} · 지속 실패 {continuing} · 비교 유보 {comparisonReview} · {Path.GetFileName(comparison.OutputPath)}";
            }
            else ComparisonStatusText.Text = "이전 결과 CSV를 선택하면 검산 뒤 비교합니다.";
            int failures = lastResult.Findings.Count(x => x.Status == "FAIL");
            int review = lastResult.Findings.Count(x => x.Status is "REVIEW" or "NOT_EVALUATED");
            StatusText.Text = $"소스 게이트 {(lastResult.SourceGatePassed ? "PASS" : "FAIL (R 규칙 차단)")} · 전체 {lastResult.Findings.Count} · FAIL {failures} · 검토 {review} · scope {lastResult.ScopeId ?? "-"}";
            OpenFolderButton.IsEnabled = true;
        }
        catch (Exception ex)
        {
            StatusText.Text = "실행하지 못했습니다.";
            MessageBox.Show(this, ex.Message, "Lukas QTO 검산기", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            RunButton.IsEnabled = true;
        }
    }

    private async void RunConcreteTakeoff(object sender, RoutedEventArgs e)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(ExportManifestBox.Text)) throw new InvalidOperationException("먼저 Revit export-manifest.csv를 선택하십시오.");
            string package = Path.GetDirectoryName(Path.GetFullPath(ExportManifestBox.Text))!;
            string report = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "LukasQto",
                "concrete_" + DateTime.Now.ToString("yyyyMMdd_HHmmss", CultureInfo.InvariantCulture) + ".csv");
            RunConcreteButton.IsEnabled = false;
            StatusText.Text = "Revit package와 승인된 콘크리트 규칙을 검증하고 있습니다...";
            DesktopConcreteTakeoffResult result = await Task.Run(() => DesktopConcreteTakeoffRunner.Run(new DesktopConcreteTakeoffRequest
            {
                ExportManifestPath = ExportManifestBox.Text,
                ElementLedgerPath = Path.Combine(package, "element-ledger.csv"),
                RevitMappingPath = ConcreteMappingBox.Text,
                ConcreteRulesPath = ConcreteRulesBox.Text,
                RegistryPath = ConcreteRegistryBox.Text,
                ReportPath = report
            }));
            StatusText.Text = $"콘크리트 산출 {result.Status} · 로컬 승인표는 관리자 trust 없이는 REVIEW · COMPUTED {result.Mapping.ComputedSelectedCount} · 승인 제외 {result.Mapping.ComputedExcludedCount} · ZERO 제외 {result.Mapping.ZeroExcludedCount} · MISSING {result.Mapping.MissingReviewCount} · {Path.GetFileName(result.Artifact.ReportPath)}";
        }
        catch (Exception ex)
        {
            StatusText.Text = "콘크리트 산출을 실행하지 못했습니다.";
            MessageBox.Show(this, ex.Message, "Lukas QTO 검산기", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally { RunConcreteButton.IsEnabled = true; }
    }

    private async void RunRebarTakeoff(object sender, RoutedEventArgs e)
    {
        try
        {
            string report = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "LukasQto", "rebar_" + DateTime.Now.ToString("yyyyMMdd_HHmmss", CultureInfo.InvariantCulture) + ".csv");
            RunRebarButton.IsEnabled = false; StatusText.Text = "철근 길이·규칙·독립 공식 kg를 검증하고 있습니다. 로컬 승인표는 관리자 trust 없이는 REVIEW입니다...";
            DesktopRebarTakeoffResult result = await Task.Run(() => DesktopRebarTakeoffRunner.Run(new DesktopRebarTakeoffRequest { LengthLedgerPath = RebarLengthBox.Text, RuleBundlePath = RebarRulesBox.Text, OfficialTargetPath = RebarOfficialBox.Text, RegistryPath = RebarRegistryBox.Text, ReportPath = report }));
            StatusText.Text = $"철근 산출 {result.Takeoff.Status} · 계산 {result.Takeoff.CalculatedMassKg?.ToString(CultureInfo.InvariantCulture) ?? "-"} kg · 공식 {result.Takeoff.OfficialMassKg?.ToString(CultureInfo.InvariantCulture) ?? "-"} kg";
        }
        catch (Exception ex) { StatusText.Text = "철근 산출을 실행하지 못했습니다."; MessageBox.Show(this, ex.Message, "Lukas QTO 검산기", MessageBoxButton.OK, MessageBoxImage.Error); }
        finally { RunRebarButton.IsEnabled = true; }
    }

    private async void InspectFormworkLedger(object sender, RoutedEventArgs e)
    {
        try
        {
            InspectFormworkButton.IsEnabled = false;
            StatusText.Text = "Revit 거푸집 face 원장과 sidecar를 검증하고 있습니다...";
            FormworkFaceLedgerImport imported = await Task.Run(() => DesktopFormworkTakeoffRunner.Inspect(FormworkLedgerBox.Text));
            int unknown = imported.Faces.Count(x => x.BoundaryKind == FormworkBoundaryKind.Unknown || x.Decision == FormworkDecision.Review);
            StatusText.Text = $"거푸집 원장 검토 완료 · {imported.Faces.Count} face · Unknown/Review {unknown} · 자동 접촉 판정 없음 · {Path.GetFileName(imported.ManifestPath)}";
        }
        catch (Exception ex) { StatusText.Text = "거푸집 원장을 검토하지 못했습니다."; MessageBox.Show(this, ex.Message, "Lukas QTO 검산기", MessageBoxButton.OK, MessageBoxImage.Error); }
        finally { InspectFormworkButton.IsEnabled = true; }
    }

    private async void RunFormworkTakeoff(object sender, RoutedEventArgs e)
    {
        try
        {
            string report = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "LukasQto", "formwork_" + DateTime.Now.ToString("yyyyMMdd_HHmmss", CultureInfo.InvariantCulture) + ".csv");
            RunFormworkButton.IsEnabled = false;
            StatusText.Text = "사용자 승인 face 판정·policy·관리자 trust를 검증하고 있습니다...";
            DesktopFormworkTakeoffResult result = await Task.Run(() => DesktopFormworkTakeoffRunner.Run(new DesktopFormworkTakeoffRequest { LedgerPath = FormworkLedgerBox.Text, ApprovalPath = FormworkApprovalBox.Text, RegistryPath = FormworkRegistryBox.Text, ReportPath = report }));
            int review = result.Takeoff.Findings.Count(x => x.Status == StructuralQuantityStatus.REVIEW || x.Status == StructuralQuantityStatus.NOT_EVALUATED);
            StatusText.Text = $"거푸집 산출 {result.Takeoff.Status} · 순수 {result.Takeoff.PureFormworkM2.ToString(CultureInfo.InvariantCulture)} m² · 검토 {review} · 부대재료는 별도 원장 없이는 0으로 추정하지 않습니다.";
        }
        catch (Exception ex) { StatusText.Text = "거푸집 산출을 실행하지 못했습니다."; MessageBox.Show(this, ex.Message, "Lukas QTO 검산기", MessageBoxButton.OK, MessageBoxImage.Error); }
        finally { RunFormworkButton.IsEnabled = true; }
    }

    private void FindingSelected(object sender, SelectionChangedEventArgs e)
    {
        // The detail panel binds directly to the DataGrid selection.
    }

    private void OpenResultFolder(object sender, RoutedEventArgs e)
    {
        if (lastResult == null) return;
        Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + lastResult.ReportPath + "\"") { UseShellExecute = true });
    }
}
