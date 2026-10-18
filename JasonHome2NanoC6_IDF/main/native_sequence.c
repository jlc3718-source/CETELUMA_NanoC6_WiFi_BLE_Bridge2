#include "native_sequence.h"
#include "native_commands.h"
#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

typedef struct{
    uint8_t effects[88];
    size_t count;
    uint32_t interval_ms,generation;
} sequence_job;
static volatile uint32_t sequence_generation=0;
static volatile bool sequence_running=false;

static void worker(void *param){
    sequence_job *job=param;
    size_t next=1;
    while(job->generation==sequence_generation){
        uint32_t waited=0;
        while(waited<job->interval_ms&&job->generation==sequence_generation){
            uint32_t step=job->interval_ms-waited;
            if(step>50)step=50;
            vTaskDelay(pdMS_TO_TICKS(step));
            waited+=step;
        }
        if(job->generation!=sequence_generation)break;
        if(!jh2_native_effect(job->effects[next++%job->count]))break;
    }
    if(job->generation==sequence_generation)sequence_running=false;
    free(job);
    vTaskDelete(NULL);
}
void jh2_native_sequence_stop(void){
    ++sequence_generation;
    sequence_running=false;
}
bool jh2_native_sequence_running(void){return sequence_running;}
bool jh2_native_sequence_start(const uint8_t *effects,size_t count,uint32_t interval_seconds){
    if(!effects||count<2||count>88||interval_seconds<5||interval_seconds>3600)return false;
    for(size_t i=0;i<count;i++)if(effects[i]>87)return false;
    jh2_native_sequence_stop();
    sequence_job *job=calloc(1,sizeof(*job));
    if(!job)return false;
    memcpy(job->effects,effects,count);
    job->count=count;
    job->interval_ms=interval_seconds*1000;
    job->generation=sequence_generation;
    if(!jh2_native_effect(job->effects[0])){
        free(job);return false;
    }
    sequence_running=true;
    if(xTaskCreate(worker,"jh2-idf-sequence",6144,job,2,NULL)!=pdPASS){
        sequence_running=false;free(job);return false;
    }
    return true;
}
