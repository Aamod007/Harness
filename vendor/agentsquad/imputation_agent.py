"""Zero-Drop Imputation & Quality Assurance Agent.

Enforces the competitive Zero-Drop Policy required by Gate 2:
1. Intelligently replaces sentinel nulls ("N/A", "-999", "NULL", empty strings).
2. Imputes numeric metrics using group medians (by department/category).
3. Fills categorical gaps with statistical modes or explicit category tags.
4. Guarantees 100.0% row survival (0 rows lazily dropped).
"""

from __future__ import annotations

from dataclasses import dataclass
import numpy as np
import pandas as pd


@dataclass
class ImputationAgentReport:
    """Audit metrics produced by ImputationAgent."""
    sentinel_nulls_imputed: int = 0
    numeric_medians_applied: int = 0
    categorical_modes_applied: int = 0
    raw_row_count: int = 0
    clean_row_count: int = 0
    row_survival_rate: float = 100.0
    lazy_drops_detected: int = 0


SENTINEL_NULL_STRINGS = {"n/a", "na", "-999", "-9999", "null", "none", "", "nan", "missing", "undefined"}


class ImputationAgent:
    """Specialized worker guaranteeing 100% row preservation and intelligent imputation."""

    def __init__(self) -> None:
        self.report = ImputationAgentReport()

    def clean(self, df: pd.DataFrame) -> tuple[pd.DataFrame, ImputationAgentReport]:
        out = df.copy()
        self.report.raw_row_count = len(out)

        # 1. Normalize sentinel nulls to genuine np.nan across all columns
        for col in out.columns:
            if pd.api.types.is_object_dtype(out[col]) or pd.api.types.is_string_dtype(out[col]):
                mask = out[col].astype(str).str.strip().str.lower().isin(SENTINEL_NULL_STRINGS)
                count = int(mask.sum())
                if count > 0:
                    out.loc[mask, col] = np.nan
                    self.report.sentinel_nulls_imputed += count
            elif pd.api.types.is_numeric_dtype(out[col]):
                mask = out[col].isin([-999, -9999, -1])
                count = int(mask.sum())
                if count > 0:
                    out.loc[mask, col] = np.nan
                    self.report.sentinel_nulls_imputed += count

        # 2. Impute missing values with group awareness (by department if available)
        dept_col = next((c for c in ["department", "dept", "team", "division"] if c in out.columns), None)

        for col in out.columns:
            if col in ["timestamp", "date", "timestamp_day", "date_iso"]:
                continue

            null_count = int(out[col].isna().sum())
            if null_count == 0:
                continue

            if pd.api.types.is_numeric_dtype(out[col]):
                # Group-by median if dept_col exists, otherwise global median
                if dept_col and out[dept_col].nunique() > 1:
                    median_map = out.groupby(dept_col)[col].transform("median")
                    global_median = out[col].median() if not pd.isna(out[col].median()) else 0.0
                    out[col] = out[col].fillna(median_map).fillna(global_median)
                else:
                    global_median = out[col].median() if not pd.isna(out[col].median()) else 0.0
                    out[col] = out[col].fillna(global_median)

                self.report.numeric_medians_applied += null_count
            else:
                # Categorical mode imputation
                mode_val = out[col].mode().iloc[0] if not out[col].mode().empty else "UNKNOWN"
                out[col] = out[col].fillna(mode_val)
                self.report.categorical_modes_applied += null_count

        self.report.clean_row_count = len(out)
        self.report.row_survival_rate = (self.report.clean_row_count / max(1, self.report.raw_row_count)) * 100.0

        return out, self.report
