if(NOT TARGET hermes-engine::hermesvm)
add_library(hermes-engine::hermesvm SHARED IMPORTED)
set_target_properties(hermes-engine::hermesvm PROPERTIES
    IMPORTED_LOCATION "/home/james/.gradle/caches/8.13/transforms/824085924f7ca97c1b65bd55aa6ee825/transformed/hermes-android-250829098.0.10-release/prefab/modules/hermesvm/libs/android.x86_64/libhermesvm.so"
    INTERFACE_INCLUDE_DIRECTORIES "/home/james/.gradle/caches/8.13/transforms/824085924f7ca97c1b65bd55aa6ee825/transformed/hermes-android-250829098.0.10-release/prefab/modules/hermesvm/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

