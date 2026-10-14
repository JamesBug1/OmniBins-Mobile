if(NOT TARGET ReactAndroid::hermestooling)
add_library(ReactAndroid::hermestooling SHARED IMPORTED)
set_target_properties(ReactAndroid::hermestooling PROPERTIES
    IMPORTED_LOCATION "/home/james/.gradle/caches/8.13/transforms/095a1a194bf6ebec9333f2bebe1b3c5a/transformed/react-android-0.85.2-release/prefab/modules/hermestooling/libs/android.x86/libhermestooling.so"
    INTERFACE_INCLUDE_DIRECTORIES "/home/james/.gradle/caches/8.13/transforms/095a1a194bf6ebec9333f2bebe1b3c5a/transformed/react-android-0.85.2-release/prefab/modules/hermestooling/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

if(NOT TARGET ReactAndroid::jsi)
add_library(ReactAndroid::jsi SHARED IMPORTED)
set_target_properties(ReactAndroid::jsi PROPERTIES
    IMPORTED_LOCATION "/home/james/.gradle/caches/8.13/transforms/095a1a194bf6ebec9333f2bebe1b3c5a/transformed/react-android-0.85.2-release/prefab/modules/jsi/libs/android.x86/libjsi.so"
    INTERFACE_INCLUDE_DIRECTORIES "/home/james/.gradle/caches/8.13/transforms/095a1a194bf6ebec9333f2bebe1b3c5a/transformed/react-android-0.85.2-release/prefab/modules/jsi/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

if(NOT TARGET ReactAndroid::reactnative)
add_library(ReactAndroid::reactnative SHARED IMPORTED)
set_target_properties(ReactAndroid::reactnative PROPERTIES
    IMPORTED_LOCATION "/home/james/.gradle/caches/8.13/transforms/095a1a194bf6ebec9333f2bebe1b3c5a/transformed/react-android-0.85.2-release/prefab/modules/reactnative/libs/android.x86/libreactnative.so"
    INTERFACE_INCLUDE_DIRECTORIES "/home/james/.gradle/caches/8.13/transforms/095a1a194bf6ebec9333f2bebe1b3c5a/transformed/react-android-0.85.2-release/prefab/modules/reactnative/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

