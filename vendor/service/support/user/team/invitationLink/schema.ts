import { connectionMongo, getMongoModel } from '../../../../common/mongo';
import { TeamCollectionName } from '../../../../../global/support/user/team/constant';
import { type InvitationSchemaType } from './type';
import { getLogger, LogCategories } from '../../../../common/logger';

const { Schema } = connectionMongo;

export const InvitationLinkCollectionName = 'team_invitation_links';

const InvitationLinkSchema = new Schema({
  linkId: {
    type: String,
    required: true,
    unique: true
  },
  teamId: {
    type: Schema.Types.ObjectId,
    ref: TeamCollectionName,
    required: true
  },
  usedTimesLimit: {
    type: Number,
    default: -1
  },
  forbidden: {
    type: Boolean,
    default: false
  },
  expires: {
    type: Date,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  members: {
    type: [Schema.Types.ObjectId],
    default: []
  }
});

const logger = getLogger(LogCategories.INFRA.MONGO);

try {
  InvitationLinkSchema.index({ teamId: 1 }, { background: true });
  InvitationLinkSchema.index({ linkId: 1 }, { unique: true });
  InvitationLinkSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });
} catch (error) {
  logger.error('Failed to build invitation link indexes', { error });
}

export const MongoInvitationLink = getMongoModel<InvitationSchemaType>(
  InvitationLinkCollectionName,
  InvitationLinkSchema
);
