import { generateQA } from "../queues/generateQA.ts";
import { generateVector } from "../queues/generateVector.ts";
import { TrainingModeEnum } from "../../../../../vendor/global/core/dataset/constants";
import { type DatasetTrainingSchemaType } from "../../../../../vendor/global/core/dataset/type";
import { MongoDatasetTraining } from "../../../../../vendor/service/core/dataset/training/schema";
import { datasetParseQueue } from "../queues/datasetParse.ts";

export const createDatasetTrainingMongoWatch = () => {
  const changeStream = MongoDatasetTraining.watch();

  return changeStream.on('change', async (change) => {
    try {
      if (change.operationType === 'insert') {
        const fullDocument = change.fullDocument as DatasetTrainingSchemaType;
        const { mode } = fullDocument;
        if (mode === TrainingModeEnum.qa) {
          generateQA();
        } else if (mode === TrainingModeEnum.chunk) {
          generateVector();
        } else if (mode === TrainingModeEnum.parse) {
          datasetParseQueue();
        }
      }
    } catch (error) {}
  });
};

export const startTrainingQueue = (fast?: boolean) => {
  const max = global.systemEnv?.qaMaxProcess || 10;

  for (let i = 0; i < (fast ? max : 1); i++) {
    generateQA();
    generateVector();
    datasetParseQueue();
  }
};
