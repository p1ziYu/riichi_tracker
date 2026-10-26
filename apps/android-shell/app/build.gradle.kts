plugins {
    id("com.android.application")
}

android {
    namespace = "com.p1ziyu.riichitracker.shell"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.p1ziyu.riichitracker.shell"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
