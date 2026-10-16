export interface Scene {
  power:boolean;
  brightness:number;
  effect:string;
  colors:number[];
  speed:number;
}
export interface ScheduleRow {
  id:string;name:string;enabled:number;days:string;start_kind:string;start_value:string;end_kind:string;end_value:string;
  target:string;effect:string;colors:string;brightness:number;speed:number;priority:number;
}
