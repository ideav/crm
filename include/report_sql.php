<?php
function ReportDistinctClause($distinct, $group)
{
	# GROUP BY already produces unique result groups. Keeping a top-level
	# DISTINCT there forces MySQL to sort the same wide report rows again.
	if(strlen(trim((string)$group)))
		return "";
	return $distinct;
}
?>
