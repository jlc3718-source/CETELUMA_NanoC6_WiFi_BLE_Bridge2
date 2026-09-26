package com.jasonhome.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Anderson Home scheduling engine ported for Jason Home. */
final class AndersonSchedule {
    enum Mode {
        MAJOR_BASIC("Major U.S. Government Holidays - Basic Colors"),
        EXPANDED_BASIC("Expanded Holidays - Basic Colors"),
        EXPANDED_COLORS("Expanded Holidays - Expanded Colors");
        final String label;
        Mode(String label){this.label=label;}
    }

    static final class Scene {
        final int eventIndex;
        final String name;
        final String effect;
        final int[] colors;
        final int speed;
        final int brightness;
        final boolean schedule2;
        Scene(int eventIndex,String name,String effect,int[] colors,int speed,int brightness,boolean schedule2){
            this.eventIndex=eventIndex;this.name=name;this.effect=effect;this.colors=colors;
            this.speed=speed;this.brightness=brightness;this.schedule2=schedule2;
        }
    }

    private static final double LAT=42.0529;
    private static final double LON=-79.0576;
    private static final double ZENITH=96.0;
    private static final SharedPreferences.OnSharedPreferenceChangeListener NOOP=(p,k)->{};

    private final SharedPreferences prefs;
    private final SharedPreferences appPrefs;

    AndersonSchedule(Context context){
        prefs=context.getSharedPreferences("jason_schedule",Context.MODE_PRIVATE);
        appPrefs=context.getSharedPreferences("anderson_android",Context.MODE_PRIVATE);
        // 4.0/4.0.1 accidentally defaulted automation ON. Reset it once on upgrade.
        if (prefs.getInt("behavior_rev",0) < 402) {
            prefs.edit().putBoolean("enabled",false).putInt("behavior_rev",402).apply();
        }
    }

    boolean enabled(){return prefs.getBoolean("enabled",false);}
    void setEnabled(boolean v){prefs.edit().putBoolean("enabled",v).apply();}

    Mode mode(){
        int v=prefs.getInt("mode",2);
        return Mode.values()[Math.max(0,Math.min(Mode.values().length-1,v))];
    }
    void setMode(Mode m){prefs.edit().putInt("mode",m.ordinal()).apply();}

    int leadDays(){return prefs.getInt("lead",2);}
    int trailDays(){return prefs.getInt("trail",0);}
    void setLeadDays(int v){prefs.edit().putInt("lead",clamp(v,0,14)).apply();}
    void setTrailDays(int v){prefs.edit().putInt("trail",clamp(v,0,14)).apply();}

    int onMinutes(){return prefs.getInt("on",17*60);}
    int offMinutes(){return prefs.getInt("off",23*60);}
    void setOnMinutes(int v){prefs.edit().putInt("on",normMinutes(v)).apply();}
    void setOffMinutes(int v){prefs.edit().putInt("off",normMinutes(v)).apply();}

    boolean startAtDusk(){return prefs.getBoolean("dusk",false);}
    void setStartAtDusk(boolean v){prefs.edit().putBoolean("dusk",v).apply();}

    boolean schedule2Enabled(){return prefs.getBoolean("s2",true);}
    void setSchedule2Enabled(boolean v){prefs.edit().putBoolean("s2",v).apply();}
    boolean schedule2EndAtDawn(){return prefs.getBoolean("s2dawn",true);}
    void setSchedule2EndAtDawn(boolean v){prefs.edit().putBoolean("s2dawn",v).apply();}
    int schedule2EndMinutes(){return prefs.getInt("s2end",6*60);}
    void setSchedule2EndMinutes(int v){prefs.edit().putInt("s2end",normMinutes(v)).apply();}
    int schedule2Brightness(){return prefs.getInt("s2brightness",10);}
    void setSchedule2Brightness(int v){prefs.edit().putInt("s2brightness",clamp(v,1,100)).apply();}

    int overlap(){return prefs.getInt("overlap",0);}
    void setOverlap(int v){prefs.edit().putInt("overlap",clamp(v,0,2)).apply();}

    Scene resolveNow(){
        return resolve(ZonedDateTime.now());
    }

    LocalDate eventStartDate(int index,int year){
        if(index<0||index>=AndersonEventData.EVENTS.length)return null;
        return startDate(index,year);
    }

    boolean eventOccursInMonth(int index,int year,int month){
        if(index<0||index>=AndersonEventData.EVENTS.length||month<1||month>12)return false;
        AndersonEventData.Event e=AndersonEventData.EVENTS[index];
        if("Month".equals(e.rule)) return e.month==month;
        LocalDate start=startDate(index,year);
        if(start==null)return false;
        LocalDate end=start.plusDays(Math.max(1,e.durationDays)-1L);
        LocalDate first=LocalDate.of(year,month,1);
        LocalDate last=first.with(TemporalAdjusters.lastDayOfMonth());
        return !end.isBefore(first)&&!start.isAfter(last);
    }

    boolean includedByMode(int index){
        return included(index);
    }

    Scene resolve(ZonedDateTime now){
        if(!enabled()||AndersonEventData.EVENTS.length==0)return null;
        LocalDate day=now.toLocalDate();
        int minute=now.getHour()*60+now.getMinute();
        int start=startAtDusk()?civilSolarMinutes(day,false,now.getZone()):onMinutes();
        int end=offMinutes();

        if(inWindow(minute,start,end)){
            Scene custom=customScene(day,false,100);
            if(custom!=null)return custom;
            return resolveFor(day,minute,start,end,false,100);
        }

        if(schedule2Enabled()){
            int s2end=schedule2EndAtDawn()?civilSolarMinutes(day,true,now.getZone()):schedule2EndMinutes();
            if(inWindow(minute,end,s2end)){
                Scene custom=customScene(day,true,schedule2Brightness());
                if(custom!=null)return custom;
                // Preserve the final Schedule-1 scene into Schedule 2.
                int last=(end+1439)%1440;
                return resolveFor(day,last,start,end,true,schedule2Brightness());
            }
        }
        return null;
    }

    String nextEventLabel(){
        ZonedDateTime now=ZonedDateTime.now();
        LocalDate today=now.toLocalDate();
        LocalDate best=null;
        int bestIndex=-1;
        for(int i=0;i<AndersonEventData.EVENTS.length;i++){
            if(!included(i)||"Month".equals(AndersonEventData.EVENTS[i].rule))continue;
            for(int y=today.getYear();y<=today.getYear()+2;y++){
                LocalDate s=startDate(i,y);
                if(s!=null&&!s.isBefore(today)&&(best==null||s.isBefore(best))){
                    if(s.equals(today)&&now.toLocalTime().isAfter(LocalTime.of(23,59)))continue;
                    best=s;bestIndex=i;
                }
            }
        }
        if(bestIndex<0)return "-";
        AndersonEventData.Event e=AndersonEventData.EVENTS[bestIndex];
        return e.name+" - "+best;
    }

    private Scene resolveFor(LocalDate day,int minute,int start,int end,boolean schedule2,int brightness){
        ArrayList<Integer> specific=new ArrayList<>();
        ArrayList<Integer> windows=new ArrayList<>();
        ArrayList<Integer> monthly=new ArrayList<>();

        for(int i=0;i<AndersonEventData.EVENTS.length;i++){
            if(!included(i))continue;
            AndersonEventData.Event e=AndersonEventData.EVENTS[i];
            if("Month".equals(e.rule)){
                if(day.getMonthValue()==e.month)monthly.add(i);
                continue;
            }
            if(activeOn(i,day)){specific.add(i);continue;}
            if("Holiday".equals(e.kind)&&windowActive(i,day,leadDays(),trailDays()))windows.add(i);
        }

        int pick=-1;
        if(!specific.isEmpty())pick=timedPick(specific,minute,start,end);
        else if(!windows.isEmpty())pick=timedPick(windows,minute,start,end);
        else if(!monthly.isEmpty()){
            if(overlap()==2)return combinedMonthly(monthly,brightness,schedule2);
            if(overlap()==1)pick=timedPick(monthly,minute,start,end);
            else pick=monthly.get((day.getDayOfMonth()-1)%monthly.size());
        }
        if(pick<0)return null;
        return sceneFor(pick,brightness,schedule2);
    }

    private Scene combinedMonthly(List<Integer> indices,int brightness,boolean schedule2){
        ArrayList<Integer> colors=new ArrayList<>();
        for(int idx:indices){
            for(int c:colorsFor(idx)){
                if(colors.size()>=8)break;
                if(!colors.contains(c))colors.add(c);
            }
            if(colors.size()>=8)break;
        }
        int[] out=new int[Math.max(1,colors.size())];
        if(colors.isEmpty())out[0]=0xFFFFFA;else for(int i=0;i<colors.size();i++)out[i]=colors.get(i);
        return new Scene(indices.get(0),"Combined monthly events","Jump",out,1,brightness,schedule2);
    }

    private Scene sceneFor(int index,int brightness,boolean schedule2){
        AndersonEventData.Event e=AndersonEventData.EVENTS[index];
        String p="event_"+e.id+"_";
        String effect=appPrefs.getString(p+"effect",e.effect);
        int speed=appPrefs.getInt(p+"speed",e.speed);
        return new Scene(index,e.name,effect,colorsFor(index),Math.max(1,Math.min(5,speed)),brightness,schedule2);
    }

    private int[] colorsFor(int index){
        AndersonEventData.Event e=AndersonEventData.EVENTS[index];
        String key="event_"+e.id+"_colors";
        if(appPrefs.contains(key)){
            try{
                JSONArray a=new JSONArray(appPrefs.getString(key,"[]"));
                if(a.length()>0){
                    int n=Math.min(8,a.length());
                    int[] out=new int[n];
                    for(int i=0;i<n;i++){
                        String h=a.optString(i,"#FFFFFF").replace("#","");
                        out[i]=(int)Long.parseLong(h,16)&0xffffff;
                    }
                    return out;
                }
            }catch(Throwable ignored){}
        }
        switch(mode()){
            case MAJOR_BASIC:return e.majorColors.clone();
            case EXPANDED_BASIC:return e.basicColors.clone();
            default:return e.modernColors.clone();
        }
    }

    private boolean included(int index){
        if(index<0||index>=AndersonEventData.EVENTS.length)return false;
        AndersonEventData.Event e=AndersonEventData.EVENTS[index];
        if(!appPrefs.getBoolean("event_"+e.id+"_enabled",true))return false;
        int cat=index<AndersonEventData.CATEGORY_INDEX.length?AndersonEventData.CATEGORY_INDEX[index]:9;
        long mask=appPrefs.getLong("category_mask",(1L<<15)-1L);
        if((mask&(1L<<cat))==0)return false;
        if(mode()!=Mode.MAJOR_BASIC)return true;
        for(int v:AndersonEventData.MAJOR)if(v==index)return true;
        return false;
    }

    private boolean activeOn(int index,LocalDate day){
        AndersonEventData.Event e=AndersonEventData.EVENTS[index];
        if("Month".equals(e.rule))return day.getMonthValue()==e.month;
        LocalDate s=startDate(index,day.getYear());
        if(s==null&&day.getMonthValue()==1)s=startDate(index,day.getYear()-1);
        if(s==null)return false;
        LocalDate end=s.plusDays(Math.max(1,e.durationDays)-1L);
        return !day.isBefore(s)&&!day.isAfter(end);
    }

    private boolean windowActive(int index,LocalDate day,int lead,int trail){
        AndersonEventData.Event e=AndersonEventData.EVENTS[index];
        for(int y=day.getYear()-1;y<=day.getYear()+1;y++){
            LocalDate s=startDate(index,y);
            if(s==null)continue;
            LocalDate a=s.minusDays(lead);
            LocalDate b=s.plusDays(Math.max(1,e.durationDays)-1L+trail);
            if(!day.isBefore(a)&&!day.isAfter(b))return true;
        }
        return false;
    }

    private LocalDate startDate(int index,int year){
        AndersonEventData.Event e=AndersonEventData.EVENTS[index];
        try{
            LocalDate d;
            switch(e.rule){
                case "Fixed":
                    d=LocalDate.of(year,e.month,e.day);
                    break;
                case "Month":
                    d=LocalDate.of(year,e.month,1);
                    break;
                case "NthWeekday":{
                    LocalDate first=LocalDate.of(year,e.month,1);
                    DayOfWeek want=fromTmWeekday(e.weekday);
                    d=first.with(TemporalAdjusters.dayOfWeekInMonth(e.nth,want));
                    break;
                }
                case "LastWeekday":{
                    LocalDate last=LocalDate.of(year,e.month,1).with(TemporalAdjusters.lastDayOfMonth());
                    d=last.with(TemporalAdjusters.previousOrSame(fromTmWeekday(e.weekday)));
                    break;
                }
                case "EasterOffset":
                    d=easter(year).plusDays(e.offsetDays);
                    return d;
                case "MonthEnd":
                    d=LocalDate.of(year,e.month,1).with(TemporalAdjusters.lastDayOfMonth());
                    break;
                case "YearTable":
                    return specialDate(index,year);
                case "Hanukkah":
                    return specialDate(index,year);
                default:
                    return null;
            }
            if(e.offsetDays!=0)d=d.plusDays(e.offsetDays);
            return d;
        }catch(Throwable ignored){
            return null;
        }
    }

    private LocalDate specialDate(int index,int year){
        for(int[] v:AndersonEventData.SPECIAL){
            if(v.length>=4&&v[0]==index&&v[1]==year)return LocalDate.of(year,v[2],v[3]);
        }
        return null;
    }

    private Scene customScene(LocalDate day,boolean schedule2,int scheduleBrightness){
        try{
            JSONArray a=new JSONArray(appPrefs.getString("custom_schedules","[]"));
            for(int i=0;i<a.length();i++){
                JSONObject x=a.optJSONObject(i);
                if(x==null||!x.optBoolean("enabled",true))continue;
                int month=x.optInt("month",-1),date=x.optInt("day",-1);
                boolean annual=x.optBoolean("annual",true);
                if(month!=day.getMonthValue()||date!=day.getDayOfMonth())continue;
                if(!annual&&x.optInt("year",-1)!=day.getYear())continue;
                JSONArray ca=x.optJSONArray("colors");
                int[] colors=new int[Math.max(1,Math.min(8,ca==null?0:ca.length()))];
                if(ca==null||ca.length()==0)colors[0]=0xFFFFFF;
                else for(int j=0;j<colors.length;j++){
                    String h=ca.optString(j,"#FFFFFF").replace("#","");
                    colors[j]=(int)Long.parseLong(h,16)&0xffffff;
                }
                int b=schedule2?scheduleBrightness:Math.max(1,Math.min(100,x.optInt("brightness",100)));
                return new Scene(-1,x.optString("name","Custom Light"),x.optString("effect","Jump"),colors,
                    Math.max(1,Math.min(5,x.optInt("speed",3))),b,schedule2);
            }
        }catch(Throwable ignored){}
        return null;
    }

    private static LocalDate easter(int year){
        int a=year%19,b=year/100,c=year%100,d=b/4,e=b%4,f=(b+8)/25,g=(b-f+1)/3;
        int h=(19*a+b-d-g+15)%30,i=c/4,k=c%4,l=(32+2*e+2*i-h-k)%7,m=(a+11*h+22*l)/451;
        int month=(h+l-7*m+114)/31;
        int day=((h+l-7*m+114)%31)+1;
        return LocalDate.of(year,month,day);
    }

    private static DayOfWeek fromTmWeekday(int w){
        switch(w){
            case 0:return DayOfWeek.SUNDAY;
            case 1:return DayOfWeek.MONDAY;
            case 2:return DayOfWeek.TUESDAY;
            case 3:return DayOfWeek.WEDNESDAY;
            case 4:return DayOfWeek.THURSDAY;
            case 5:return DayOfWeek.FRIDAY;
            default:return DayOfWeek.SATURDAY;
        }
    }

    private static int timedPick(List<Integer> list,int minute,int start,int end){
        if(list.size()==1)return list.get(0);
        int span=end-start;if(span<=0)span+=1440;
        int elapsed=minute-start;if(elapsed<0)elapsed+=1440;
        if(elapsed>=span)elapsed=span-1;
        int slot=(int)(((long)Math.max(0,elapsed)*list.size())/Math.max(1,span));
        if(slot>=list.size())slot=list.size()-1;
        return list.get(slot);
    }

    private static boolean inWindow(int now,int start,int end){
        if(start==end)return true;
        if(start<end)return now>=start&&now<end;
        return now>=start||now<end;
    }

    int civilDawnMinutes(LocalDate day){return civilSolarMinutes(day,true,ZoneId.systemDefault());}
    int civilDuskMinutes(LocalDate day){return civilSolarMinutes(day,false,ZoneId.systemDefault());}

    private static int civilSolarMinutes(LocalDate day,boolean dawn,ZoneId zone){
        int n=day.getDayOfYear();
        double lngHour=LON/15.0;
        double t=n+(((dawn?6.0:18.0)-lngHour)/24.0);
        double M=0.9856*t-3.289;
        double L=normDeg(M+1.916*Math.sin(Math.toRadians(M))+0.020*Math.sin(Math.toRadians(2*M))+282.634);
        double RA=normDeg(Math.toDegrees(Math.atan(0.91764*Math.tan(Math.toRadians(L)))));
        double lq=Math.floor(L/90.0)*90.0,rq=Math.floor(RA/90.0)*90.0;
        RA=(RA+(lq-rq))/15.0;
        double sd=0.39782*Math.sin(Math.toRadians(L));
        double cd=Math.cos(Math.asin(sd));
        double ch=(Math.cos(Math.toRadians(ZENITH))-sd*Math.sin(Math.toRadians(LAT)))/
            (cd*Math.cos(Math.toRadians(LAT)));
        if(ch>1.0||ch< -1.0)return dawn?360:1080;
        double hDeg=dawn?360.0-Math.toDegrees(Math.acos(ch)):Math.toDegrees(Math.acos(ch));
        double H=hDeg/15.0;
        double utc=normHours(H+RA-(0.06571*t)-6.622-lngHour);
        ZonedDateTime noon=day.atTime(12,0).atZone(zone);
        int offsetMinutes=noon.getOffset().getTotalSeconds()/60;
        double local=normHours(utc+offsetMinutes/60.0);
        return normMinutes((int)Math.round(local*60.0));
    }

    private static double normDeg(double v){while(v<0)v+=360;while(v>=360)v-=360;return v;}
    private static double normHours(double v){while(v<0)v+=24;while(v>=24)v-=24;return v;}
    private static int normMinutes(int v){v%=1440;if(v<0)v+=1440;return v;}
    private static int clamp(int v,int lo,int hi){return Math.max(lo,Math.min(hi,v));}
}
