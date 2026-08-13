using Autodesk.Revit.DB;

namespace THEKIE.Qto.Compat
{
    /// <summary>
    /// Revit 버전별 API 파괴적 변경을 한곳에 격리한다.
    /// 새 버전이 추가되면 원칙적으로 이 파일만 손대면 되도록 유지할 것.
    /// </summary>
    internal static class RevitCompat
    {
        /// <summary>
        /// ElementId의 정수값.
        /// Revit 2024에서 ElementId가 64비트로 확장되면서 IntegerValue(int)가
        /// Value(long)로 대체되고 IntegerValue는 Obsolete 처리되었다.
        /// </summary>
        public static long GetIdValue(ElementId id)
        {
#if REVIT2017 || REVIT2022 || REVIT2023
            return id.IntegerValue;
#else
            return id.Value;
#endif
        }

        public static double ToCubicMeters(double internalValue)
        {
#if REVIT2017
            return UnitUtils.ConvertFromInternalUnits(internalValue, DisplayUnitType.DUT_CUBIC_METERS);
#else
            return UnitUtils.ConvertFromInternalUnits(internalValue, UnitTypeId.CubicMeters);
#endif
        }

        public static double ToSquareMeters(double internalValue)
        {
#if REVIT2017
            return UnitUtils.ConvertFromInternalUnits(internalValue, DisplayUnitType.DUT_SQUARE_METERS);
#else
            return UnitUtils.ConvertFromInternalUnits(internalValue, UnitTypeId.SquareMeters);
#endif
        }

        public static double ToMeters(double internalValue)
        {
#if REVIT2017
            return UnitUtils.ConvertFromInternalUnits(internalValue, DisplayUnitType.DUT_METERS);
#else
            return UnitUtils.ConvertFromInternalUnits(internalValue, UnitTypeId.Meters);
#endif
        }
    }
}
