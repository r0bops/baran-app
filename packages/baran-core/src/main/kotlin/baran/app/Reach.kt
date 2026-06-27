package baran.app

/**
 * Internet reach — computed from signed bridge/anchor receipts, NEVER asserted.
 * This is a SEPARATE axis from the trust tier: a record can be fully verified
 * (self_confirmed) yet still only `in_mesh`. The UI must always show both.
 */
enum class ReachLevel { IN_MESH, BRIDGED, ANCHORED }

object Reach {
    fun compute(hasBridgeReceipt: Boolean, hasAnchor: Boolean): ReachLevel = when {
        hasAnchor -> ReachLevel.ANCHORED
        hasBridgeReceipt -> ReachLevel.BRIDGED
        else -> ReachLevel.IN_MESH
    }
}
