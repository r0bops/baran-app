rootProject.name = "baran"

include("baran-core")
project(":baran-core").projectDir = file("packages/baran-core")

include("android")
project(":android").projectDir = file("apps/android")
