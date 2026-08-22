using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Lukas.Qto.Compat;

namespace Lukas.Qto.Core
{
    /// <summary>
    /// 모델에서 수량을 뽑아 카테고리·패밀리·타입·레벨 단위로 집계한다.
    ///
    /// 설계 원칙: 여기에는 숫자만 있고 판단이 없다.
    /// 오류 판정(누락/중복/단가이상)은 별도 검증 계층이 담당하며,
    /// 그 계층은 결정론적 룰로 구현한다.
    /// </summary>
    public static class QuantityExtractor
    {
        // Revit 내부 단위는 피트 계열. 표기는 미터 계열로 변환한다.
        private static readonly BuiltInParameter[] VolumeParams =
        {
            BuiltInParameter.HOST_VOLUME_COMPUTED
        };

        private static readonly BuiltInParameter[] AreaParams =
        {
            BuiltInParameter.HOST_AREA_COMPUTED
        };

        private static readonly BuiltInParameter[] LengthParams =
        {
            BuiltInParameter.CURVE_ELEM_LENGTH,
            BuiltInParameter.INSTANCE_LENGTH_PARAM
        };

        public static List<QtoRow> Extract(Document doc)
        {
            return Extract(doc, new RevitExtractionCounts());
        }

        public static List<QtoRow> Extract(Document doc, RevitExtractionCounts counts)
        {
            if (doc == null) throw new ArgumentNullException("doc");
            if (counts == null) throw new ArgumentNullException("counts");

            var map = new Dictionary<string, QtoRow>();

            foreach (Element e in RevitExtractionScopeReader.Collect(doc, RevitExtractionScope.EntireHostModel, null, null, counts))
            {
                Category cat = e.Category;

                ElementType type = doc.GetElement(e.GetTypeId()) as ElementType;

                var row = new QtoRow
                {
                    Category = SafeString(cat.Name),
                    FamilyName = type != null ? SafeString(type.FamilyName) : "(없음)",
                    TypeName = type != null ? SafeString(type.Name) : SafeString(e.Name),
                    Level = GetLevelName(doc, e)
                };

                QtoRow target;
                if (!map.TryGetValue(row.GroupKey, out target))
                {
                    target = row;
                    map[row.GroupKey] = target;
                }

                target.Count++;
                target.ElementIds.Add(RevitCompat.GetIdValue(e.Id));

                target.VolumeM3 += Convert(e, VolumeParams, RevitCompat.ToCubicMeters);
                target.AreaM2 += Convert(e, AreaParams, RevitCompat.ToSquareMeters);
                target.LengthM += Convert(e, LengthParams, RevitCompat.ToMeters);
            }

            return map.Values
                .OrderBy(r => r.Category)
                .ThenBy(r => r.FamilyName)
                .ThenBy(r => r.TypeName)
                .ToList();
        }

        /// <summary>
        /// 후보 파라미터를 순서대로 시도하고 첫 유효값을 미터 계열로 변환한다.
        /// 값이 없으면 0. 추정하지 않는다.
        /// </summary>
        private static double Convert(Element e, BuiltInParameter[] candidates, Func<double, double> converter)
        {
            foreach (BuiltInParameter bip in candidates)
            {
                Parameter p = e.get_Parameter(bip);
                if (p == null || !p.HasValue) continue;
                if (p.StorageType != StorageType.Double) continue;

                double internalValue = p.AsDouble();
                if (Math.Abs(internalValue) < 1e-9) continue;

                return converter(internalValue);
            }
            return 0.0;
        }

        private static string GetLevelName(Document doc, Element e)
        {
            if (e.LevelId != null && e.LevelId != ElementId.InvalidElementId)
            {
                Element lvl = doc.GetElement(e.LevelId);
                if (lvl != null) return SafeString(lvl.Name);
            }
            return "(레벨없음)";
        }

        private static string SafeString(string s)
        {
            return string.IsNullOrWhiteSpace(s) ? "(미지정)" : s.Trim();
        }
    }
}
