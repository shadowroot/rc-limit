idf_component_register(SRCS "main.cpp" "model_json.cpp" "transport.cpp" "radio.cpp"
    INCLUDE_DIRS "." "../../rc_limiter"
    REQUIRES driver esp_timer esp_system nvs_flash bt json)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
