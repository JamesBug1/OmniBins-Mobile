if(NOT TARGET hermes-engine::hermesvm)
add_library(hermes-engine::hermesvm SHARED IMPORTED)
set_target_properties(hermes-engine::hermesvm PROPERTIES
    IMPORTED_LOCATION "/home/james/.gradle/caches/8.13/transforms/64cfa960910b62b439e25a79f86ccbc8/transformed/hermes-android-250829098.0.10-debug/prefab/modules/hermesvm/libs/android.x86_64/libhermesvm.so"
    INTERFACE_INCLUDE_DIRECTORIES "/home/james/.gradle/caches/8.13/transforms/64cfa960910b62b439e25a79f86ccbc8/transformed/hermes-android-250829098.0.10-debug/prefab/modules/hermesvm/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

