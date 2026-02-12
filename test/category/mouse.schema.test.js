import test from 'node:test';
import assert from 'node:assert/strict';

const FIELD_ORDER = [
  "release_date",
  "discontinued",
  "price_range",
  "colors",
  "design",
  "lighting",
  "rgb",
  "connection",
  "connectivity",
  "computer_side_connector",
  "mouse_side_connector",
  "bluetooth",
  "cable_type",
  "paracord",
  "wireless_charging",
  "battery_hours",
  "adjustable_weight",
  "feet_material",
  "coating",
  "honeycomb_frame",
  "silent_clicks",
  "weight",
  "material",
  "lngth",
  "width",
  "height",
  "form_factor",
  "shape",
  "hump",
  "front_flare",
  "thumb_rest",
  "grip",
  "hand_size",
  "mcu",
  "mcu_link",
  "sensor",
  "sensor_brand",
  "sensor_date",
  "sensor_link",
  "sensor_type",
  "flawless_sensor",
  "sensor_latency",
  "sensor_latency_list",
  "shift_latency",
  "polling_rate",
  "dpi",
  "ips",
  "acceleration",
  "lift",
  "lift_settings",
  "motion_sync",
  "hardware_acceleration",
  "smoothing",
  "nvidia_reflex",
  "switch",
  "switch_brand",
  "switch_type",
  "switch_link",
  "hot_swappable",
  "debounce",
  "click_latency",
  "click_latency_list",
  "click_force",
  "encoder",
  "encoder_brand",
  "encoder_link",
  "side_buttons",
  "middle_buttons",
  "programmable_buttons",
  "tilt_scroll_wheel",
  "adjustable_scroll_wheel",
  "onboard_memory",
  "onboard_memory_value",
  "profile_switching",
  "edition"
];
const REQUIRED_FIELDS = [
  "connection",
  "connectivity",
  "weight",
  "lngth",
  "width",
  "height",
  "sensor",
  "sensor_brand",
  "polling_rate",
  "dpi",
  "switch",
  "switch_brand",
  "side_buttons",
  "middle_buttons"
];
const EXPECTED_EASY_FIELDS = [
  "connection",
  "connectivity",
  "dpi",
  "height",
  "lngth",
  "middle_buttons",
  "polling_rate",
  "sensor",
  "sensor_brand",
  "side_buttons",
  "switch",
  "switch_brand",
  "weight",
  "width"
];
const EXPECTED_SOMETIMES_FIELDS = [
  "acceleration",
  "adjustable_scroll_wheel",
  "adjustable_weight",
  "battery_hours",
  "bluetooth",
  "coating",
  "colors",
  "computer_side_connector",
  "design",
  "edition",
  "feet_material",
  "form_factor",
  "front_flare",
  "grip",
  "hand_size",
  "honeycomb_frame",
  "hot_swappable",
  "hump",
  "ips",
  "lighting",
  "material",
  "mouse_side_connector",
  "onboard_memory",
  "price_range",
  "profile_switching",
  "programmable_buttons",
  "release_date",
  "rgb",
  "shape",
  "silent_clicks",
  "switch_type",
  "thumb_rest",
  "tilt_scroll_wheel"
];
const DEEP_FIELDS = [
  "cable_type",
  "click_force",
  "click_latency",
  "click_latency_list",
  "debounce",
  "discontinued",
  "encoder",
  "encoder_brand",
  "encoder_link",
  "flawless_sensor",
  "hardware_acceleration",
  "lift",
  "lift_settings",
  "mcu",
  "mcu_link",
  "motion_sync",
  "nvidia_reflex",
  "onboard_memory_value",
  "paracord",
  "sensor_date",
  "sensor_latency",
  "sensor_latency_list",
  "sensor_link",
  "sensor_type",
  "shift_latency",
  "smoothing",
  "switch_link",
  "wireless_charging"
];

test('mouse expectations map only known schema fields', () => {
  const known = new Set(FIELD_ORDER);
  for (const field of [...REQUIRED_FIELDS, ...EXPECTED_EASY_FIELDS, ...EXPECTED_SOMETIMES_FIELDS, ...DEEP_FIELDS]) {
    assert.equal(known.has(field), true, `Unknown field in expectations: ${field}`);
  }
});

test('mouse required fields are tracked as expected-easy', () => {
  const easy = new Set(EXPECTED_EASY_FIELDS);
  for (const field of REQUIRED_FIELDS) {
    assert.equal(easy.has(field), true, `Required field missing from expected_easy_fields: ${field}`);
  }
});

test('mouse expectation buckets do not overlap unexpectedly', () => {
  const easy = new Set(EXPECTED_EASY_FIELDS);
  const sometimes = new Set(EXPECTED_SOMETIMES_FIELDS);
  const deep = new Set(DEEP_FIELDS);
  for (const field of easy) {
    assert.equal(deep.has(field), false, `Field appears in expected_easy and deep: ${field}`);
  }
  for (const field of sometimes) {
    assert.equal(deep.has(field), false, `Field appears in expected_sometimes and deep: ${field}`);
  }
});

