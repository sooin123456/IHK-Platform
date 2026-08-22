using System;
using System.Diagnostics;
using System.IO;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace Lukas.Qto.Commands
{
    /// <summary>설치된 로컬 검산기를 찾는다. 네트워크·Revit 문서 처리는 하지 않는다.</summary>
    [Transaction(TransactionMode.ReadOnly)]
    public class OpenDesktopCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            string local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Lukas QTO", "Desktop", "Lukas.Qto.Desktop.exe");
            string machine = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Lukas QTO", "Desktop", "Lukas.Qto.Desktop.exe");
            string path = File.Exists(local) ? local : File.Exists(machine) ? machine : null;
            if (path == null)
            {
                message = "Lukas QTO 검산기를 찾을 수 없습니다. 사용자 설치본 또는 시스템 설치본을 먼저 설치하십시오.";
                return Result.Failed;
            }
            try
            {
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = "검산기를 열지 못했습니다: " + ex.Message;
                return Result.Failed;
            }
        }
    }
}
