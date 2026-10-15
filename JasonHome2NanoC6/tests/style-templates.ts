// Animation fields from the live Eufy catalog, audited 2026-09-29.
// Keep control/count/interval fields from the source; only palette, speed and direction are adapted.
export const STYLE_TEMPLATES:Record<string,{lightId:number;name:string;speed:number;layerExecutionMode:number;layers:Array<Record<string,unknown>>}>= {
  "Jump": {
    "lightId": 10296,
    "name": "Early Spring",
    "speed": 1,
    "layerExecutionMode": 0,
    "layers": [
      {
        "layer_priority": 0,
        "layer_speed": 1,
        "layer_range": [
          0,
          100
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 1,
        "colors": "7aff7a|b6ff7a|ff7ab6",
        "brightness_value": 100,
        "display_mode": 1,
        "color_quantity_range": 3,
        "transition_mode": 0,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      }
    ]
  },
  "Breath": {
    "lightId": 10996,
    "name": "Miami Vibe",
    "speed": 50,
    "layerExecutionMode": 0,
    "layers": [
      {
        "layer_priority": 0,
        "layer_speed": 20,
        "layer_range": [
          0,
          100
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 0,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 2,
        "colors": "1100fe",
        "brightness_variation_type": 1,
        "brightness_range": [
          6,
          100
        ],
        "blink_cycle_count": 1,
        "blink_position_mode": 0,
        "blink_interval": 0,
        "blink_quantity": 255,
        "blink_asynchrony": 0,
        "blink_color_switch_mode": 0,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1,
        "is_lights_move_with_people": 0
      }
    ]
  },
  "Strobe": {
    "lightId": 10900,
    "name": "W Strobe",
    "speed": 40,
    "layerExecutionMode": 0,
    "layers": [
      {
        "layer_priority": 0,
        "layer_speed": 54,
        "layer_range": [
          0,
          100
        ],
        "interval_type": 0,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "ffffff",
        "color_fill_mode": 1,
        "color_pick_mode": 0,
        "flow_direction": 0,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 1,
        "insert_black_block_mode": 2,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1,
        "is_lights_move_with_people": 0
      }
    ]
  },
  "Chase": {
    "lightId": 10735,
    "name": "Netherlands",
    "speed": 40,
    "layerExecutionMode": 0,
    "layers": [
      {
        "layer_priority": 0,
        "layer_speed": 24,
        "layer_range": [
          0,
          100
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "ff0000|fdffff|0000ff",
        "color_fill_mode": 0,
        "color_pick_mode": 0,
        "flow_direction": 1,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 10,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 0,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      }
    ]
  },
  "Gradient Sweep": {
    "lightId": 10775,
    "name": "Candy Land",
    "speed": 35,
    "layerExecutionMode": 0,
    "layers": [
      {
        "layer_priority": 0,
        "layer_speed": 20,
        "layer_range": [
          0,
          25
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "ffb6c1|ff00c1|00bfff|adff2f|00ff00|ffa500",
        "color_fill_mode": 0,
        "color_pick_mode": 1,
        "gradient_value": 190,
        "flow_direction": 0,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 1,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 0,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      },
      {
        "layer_priority": 0,
        "layer_speed": 20,
        "layer_range": [
          25,
          50
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "00ff00|adff2f|00bfff|ff00c1|ffb6c1|ffa500",
        "color_fill_mode": 0,
        "color_pick_mode": 1,
        "gradient_value": 190,
        "flow_direction": 0,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 1,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 0,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      },
      {
        "layer_priority": 0,
        "layer_speed": 20,
        "layer_range": [
          50,
          75
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "ffb6c1|ff00c1|00bfff|adff2f|00ff00|ffa500",
        "color_fill_mode": 0,
        "color_pick_mode": 1,
        "gradient_value": 190,
        "flow_direction": 0,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 1,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 0,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      },
      {
        "layer_priority": 0,
        "layer_speed": 20,
        "layer_range": [
          75,
          100
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "ffa500|00ff00|adff2f|00bfff|ff00c1|ffb6c1",
        "color_fill_mode": 0,
        "color_pick_mode": 1,
        "gradient_value": 190,
        "flow_direction": 0,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 1,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 0,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      }
    ]
  },
  "Candy Cane": {
    "lightId": 10740,
    "name": "United States",
    "speed": 40,
    "layerExecutionMode": 0,
    "layers": [
      {
        "layer_priority": 0,
        "layer_speed": 24,
        "layer_range": [
          0,
          100
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "ff0000|fdffff|0000ff",
        "color_fill_mode": 0,
        "color_pick_mode": 0,
        "flow_direction": 1,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 255,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 0,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      }
    ]
  },
  "Twinkle / Sparkle": {
    "lightId": 10670,
    "name": "Forest Mystery",
    "speed": 20,
    "layerExecutionMode": 0,
    "layers": [
      {
        "layer_priority": 0,
        "layer_speed": 30,
        "layer_range": [
          0,
          35
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 2,
        "colors": "0000ff",
        "brightness_variation_type": 3,
        "brightness_range": [
          15,
          100
        ],
        "blink_cycle_count": 1,
        "blink_position_mode": 1,
        "blink_interval": [
          1,
          7
        ],
        "blink_quantity": 1,
        "blink_asynchrony": 0,
        "blink_color_switch_mode": 0,
        "light_effect_cycle_method": 1
      }
    ]
  },
  "Wipe / Fill": {
    "lightId": 10333,
    "name": "Sunshine",
    "speed": 25,
    "layerExecutionMode": 0,
    "layers": [
      {
        "layer_priority": 0,
        "layer_speed": 30,
        "layer_range": [
          0,
          100
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "ff0000|ff8200|daa400",
        "color_fill_mode": 1,
        "color_pick_mode": 0,
        "flow_direction": 0,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 4,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 0,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      }
    ]
  },
  "Meteor / Comet": {
  "lightId": 10815,
  "name": "Thunderstorm",
  "speed": 46,
  "layerExecutionMode": 0,
  "layers": [
    {
      "layer_priority": 1,
      "layer_speed": 16,
      "layer_range": [
        0,
        100
      ],
      "interval_type": 1,
      "interval_value": 1,
      "layer_execution_parameter": 128,
      "light_effect_post_cycle_status": 0,
      "current_layer_type": 2,
      "colors": "0000ff|fdffff",
      "brightness_variation_type": 3,
      "brightness_range": [
        9,
        100
      ],
      "blink_cycle_count": 1,
      "blink_position_mode": 0,
      "blink_interval": 0,
      "blink_quantity": 255,
      "blink_asynchrony": 0,
      "blink_color_switch_mode": 0,
      "light_effect_cycle_method": 1
    },
    {
      "layer_priority": 0,
      "layer_speed": 36,
      "layer_range": [
        20,
        70
      ],
      "interval_type": 1,
      "interval_value": 1,
      "layer_execution_parameter": 139,
      "light_effect_post_cycle_status": 3,
      "current_layer_type": 0,
      "colors": "8cdaff",
      "color_fill_mode": 0,
      "color_pick_mode": 0,
      "flow_direction": 1,
      "direction_change_mode": 2,
      "insert_block_mode": 1,
      "insert_block_range": [
        5,
        9
      ],
      "insert_black_block_mode": 0,
      "insert_black_block_range": 255,
      "brightness_variation_type": 4,
      "brightness_range": [
        12,
        100
      ],
      "light_effect_cycle_method": 1
    }
  ]
},
  "Rainbow Flow": {
    "lightId": 10775,
    "name": "Candy Land",
    "speed": 35,
    "layerExecutionMode": 0,
    "layers": [
      {
        "layer_priority": 0,
        "layer_speed": 20,
        "layer_range": [
          0,
          25
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "ffb6c1|ff00c1|00bfff|adff2f|00ff00|ffa500",
        "color_fill_mode": 0,
        "color_pick_mode": 1,
        "gradient_value": 190,
        "flow_direction": 0,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 1,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 0,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      },
      {
        "layer_priority": 0,
        "layer_speed": 20,
        "layer_range": [
          25,
          50
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "00ff00|adff2f|00bfff|ff00c1|ffb6c1|ffa500",
        "color_fill_mode": 0,
        "color_pick_mode": 1,
        "gradient_value": 190,
        "flow_direction": 0,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 1,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 0,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      },
      {
        "layer_priority": 0,
        "layer_speed": 20,
        "layer_range": [
          50,
          75
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "ffb6c1|ff00c1|00bfff|adff2f|00ff00|ffa500",
        "color_fill_mode": 0,
        "color_pick_mode": 1,
        "gradient_value": 190,
        "flow_direction": 0,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 1,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 0,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      },
      {
        "layer_priority": 0,
        "layer_speed": 20,
        "layer_range": [
          75,
          100
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "ffa500|00ff00|adff2f|00bfff|ff00c1|ffb6c1",
        "color_fill_mode": 0,
        "color_pick_mode": 1,
        "gradient_value": 190,
        "flow_direction": 0,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 1,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 0,
        "brightness_variation_type": 0,
        "brightness_range": 100,
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      }
    ]
  },
  "Pulse Wave": {
    "lightId": 10340,
    "name": "Early Summer",
    "speed": 45,
    "layerExecutionMode": 0,
    "layers": [
      {
        "layer_priority": 0,
        "layer_speed": 12,
        "layer_range": [
          0,
          100
        ],
        "interval_type": 1,
        "interval_value": 1,
        "layer_execution_parameter": 128,
        "light_effect_post_cycle_status": 0,
        "current_layer_type": 0,
        "colors": "00fdff|00ff00|ffff00",
        "color_fill_mode": 0,
        "color_pick_mode": 0,
        "flow_direction": 0,
        "direction_change_mode": 0,
        "insert_block_mode": 0,
        "insert_block_range": 4,
        "insert_black_block_mode": 0,
        "insert_black_block_range": 1,
        "brightness_variation_type": 3,
        "brightness_range": [
          10,
          100
        ],
        "light_effect_cycle_method": 0,
        "execution_parameter": 1
      }
    ]
  }
};
