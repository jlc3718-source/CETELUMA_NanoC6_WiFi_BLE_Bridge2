export interface SegmentPattern {
  blocks?:number[];
  offset?:number;
  mirror?:boolean;
  // Optional exact logical lamp addresses assigned to palette color #2.
  // Used for fast transient overlays such as Test Halloween random flashes.
  positions?:number[];
}
export interface Scene {
  power:boolean;
  brightness:number;
  effect:string;
  colors:number[];
  speed:number;
  factoryEffectName?:string;
  pattern?:SegmentPattern;
}
export interface ScheduleRow {
  id:string;name:string;enabled:number;days:string;start_kind:string;start_value:string;end_kind:string;end_value:string;
  target:string;effect:string;colors:string;brightness:number;speed:number;priority:number;
}
