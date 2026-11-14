"""Reference for Merge File by Key, produced with pandas. Run from this directory:

    uv run --with pandas python merge-reference.py

Reads chembl-compounds.csv (the data fields of chembl-compounds.sdf) and
chembl-activities.csv and writes the left join in both duplicate modes plus
the unmatched and repeated keys.
"""
import json

import pandas as pd

LEFT_KEY = "ChEMBL ID"
RIGHT_KEY = "molecule_chembl_id"

left = pd.read_csv("chembl-compounds.csv", dtype=str, keep_default_na=False)
right = pd.read_csv("chembl-activities.csv", dtype=str, keep_default_na=False)
# An empty key is a missing key, and a missing key never matches anything.
keyed_right = right[right[RIGHT_KEY] != ""]


def left_join(other):
    merged = left.merge(other, how="left", left_on=LEFT_KEY, right_on=RIGHT_KEY, suffixes=("", "_2"))
    return merged.drop(columns=[RIGHT_KEY]).fillna("")


left_join(keyed_right.drop_duplicates(RIGHT_KEY, keep="first")).to_csv("merge-expected-first.csv", index=False)
left_join(keyed_right).to_csv("merge-expected-expand.csv", index=False)

left_keys = left[LEFT_KEY]
right_keys = keyed_right[RIGHT_KEY]
right_counts = right_keys.value_counts(sort=False)
left_counts = left_keys[left_keys != ""].value_counts(sort=False)
report = {
    "matchedRows": int(left_keys.isin(right_keys).sum()),
    "unmatchedLeft": [int(i) for i in left.index[(left_keys != "") & ~left_keys.isin(right_keys)]],
    "emptyLeftKeys": [int(i) for i in left.index[left_keys == ""]],
    "unmatchedRight": [key for key in right_keys.drop_duplicates() if key not in set(left_keys)],
    "emptyRightKeys": int((right[RIGHT_KEY] == "").sum()),
    "duplicateRight": [{"key": key, "count": int(count)} for key, count in right_counts.items() if count > 1],
    "duplicateLeft": [{"key": key, "count": int(count)} for key, count in left_counts.items() if count > 1],
}
with open("merge-expected-report.json", "w") as handle:
    json.dump(report, handle, indent=2)
    handle.write("\n")
