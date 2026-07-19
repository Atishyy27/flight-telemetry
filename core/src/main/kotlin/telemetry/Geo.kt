package telemetry

import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

data class LatLon(val latDeg: Double, val lonDeg: Double)

/** Great-circle distance and interpolation. Formulas per the Aviation Formulary (Ed Williams). */
object Geo {
    private const val EARTH_RADIUS_NM = 3440.065

    fun haversineNm(a: LatLon, b: LatLon): Double {
        val lat1 = Math.toRadians(a.latDeg)
        val lat2 = Math.toRadians(b.latDeg)
        val dLat = Math.toRadians(b.latDeg - a.latDeg)
        val dLon = Math.toRadians(b.lonDeg - a.lonDeg)
        val h = sin(dLat / 2).pow(2) + cos(lat1) * cos(lat2) * sin(dLon / 2).pow(2)
        return 2 * EARTH_RADIUS_NM * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }

    /** Point at [fraction] (0..1) along the great circle from [a] to [b]. */
    fun greatCircleIntermediate(a: LatLon, b: LatLon, fraction: Double): LatLon {
        val f = fraction.coerceIn(0.0, 1.0)
        val lat1 = Math.toRadians(a.latDeg)
        val lon1 = Math.toRadians(a.lonDeg)
        val lat2 = Math.toRadians(b.latDeg)
        val lon2 = Math.toRadians(b.lonDeg)
        val d = 2 * asin(
            sqrt(
                sin((lat2 - lat1) / 2).pow(2) + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2).pow(2)
            ).coerceIn(0.0, 1.0)
        )
        if (d < 1e-12) return a
        val angA = sin((1 - f) * d) / sin(d)
        val angB = sin(f * d) / sin(d)
        val x = angA * cos(lat1) * cos(lon1) + angB * cos(lat2) * cos(lon2)
        val y = angA * cos(lat1) * sin(lon1) + angB * cos(lat2) * sin(lon2)
        val z = angA * sin(lat1) + angB * sin(lat2)
        val lat = atan2(z, sqrt(x * x + y * y))
        val lon = atan2(y, x)
        return LatLon(Math.toDegrees(lat), Math.toDegrees(lon))
    }
}

data class Landmark(val name: String, val position: LatLon)

object LandmarkFinder {
    /** Nearest landmark to [position], or null if none within [maxDistanceNm]. */
    fun nearest(position: LatLon, landmarks: List<Landmark>, maxDistanceNm: Double = 25.0): Landmark? {
        val closest = landmarks.minByOrNull { Geo.haversineNm(position, it.position) } ?: return null
        return closest.takeIf { Geo.haversineNm(position, it.position) <= maxDistanceNm }
    }
}
