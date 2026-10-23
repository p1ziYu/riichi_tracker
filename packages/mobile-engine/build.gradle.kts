plugins {
    kotlin("multiplatform") version "2.2.0"
}

group = "com.riichi"
version = "0.1.0"

repositories {
    mavenCentral()
}

kotlin {
    jvm()
    if (System.getProperty("os.name").startsWith("Mac", ignoreCase = true)) {
        iosArm64()
        iosSimulatorArm64()
        targets.withType<org.jetbrains.kotlin.gradle.plugin.mpp.KotlinNativeTarget>().configureEach {
            binaries.framework {
                baseName = "MobileEngine"
                isStatic = true
            }
        }
    }
    sourceSets {
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
        jvmTest.dependencies {
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
        }
    }
}
