pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "venrescate"

include("venrescate-core")
project(":venrescate-core").projectDir = file("packages/venrescate-core")

include("android")
project(":android").projectDir = file("apps/android")
