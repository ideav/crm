<?php
require __DIR__ . "/../include/report_sql.php";

function assertSame($expected, $actual, $message)
{
	if($expected !== $actual){
		fwrite(STDERR, "FAIL: $message\nExpected: ".var_export($expected, true)."\nActual: ".var_export($actual, true)."\n");
		exit(1);
	}
	echo "PASS: $message\n";
}

$groupedDistinct = ReportDistinctClause("DISTINCT", "GROUP BY a985.val, a986_val");
$groupedSql = "SELECT $groupedDistinct a985.val, GROUP_CONCAT(DISTINCT a1105_val) RGcolumns FROM sportzania a985 GROUP BY a985.val, a986_val";
assertSame(0, preg_match('/^SELECT\s+DISTINCT\b/i', $groupedSql), "grouped aggregate reports do not keep redundant top-level DISTINCT");

$plainDistinct = ReportDistinctClause("DISTINCT", "");
$plainSql = "SELECT $plainDistinct a985.val FROM sportzania a985";
assertSame(1, preg_match('/^SELECT\s+DISTINCT\b/i', $plainSql), "plain multiselect reports still keep DISTINCT");

echo "All issue #2294 report DISTINCT tests passed.\n";
?>
