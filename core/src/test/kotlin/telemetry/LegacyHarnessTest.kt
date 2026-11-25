package telemetry

import kotlin.test.Test
import kotlin.test.assertEquals

class LegacyHarnessTest {
    @Test
    fun verifyMainChecksAllPass() {
        assertEquals(0, runAllChecks())
    }
}
