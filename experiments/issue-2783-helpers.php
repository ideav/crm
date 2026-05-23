<?php
/**
 * Shared assertion helpers for issue #2783 test harnesses.
 */

if(!function_exists("assert_eq")){
    function assert_eq($label, $expected, $actual){
        $expStr = is_scalar($expected) ? (string)$expected : json_encode($expected, JSON_UNESCAPED_UNICODE);
        $actStr = is_scalar($actual)   ? (string)$actual   : json_encode($actual,   JSON_UNESCAPED_UNICODE);
        if($expected === $actual){
            echo "  OK  $label  ($actStr)\n";
            return;
        }
        echo "  FAIL  $label\n";
        echo "    expected: $expStr\n";
        echo "    actual:   $actStr\n";
        throw new RuntimeException("Assertion failed: $label");
    }
}
