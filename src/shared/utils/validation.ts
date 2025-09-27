import { z } from 'zod';
import { CallType, CallStatus, ParticipantRole } from '../types';

// Common validation schemas
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// User validation schemas
export const registerUserSchema = z.object({
  body: z.object({
    name: z.string()
      .min(2, 'Name must be at least 2 characters')
      .max(100, 'Name cannot exceed 100 characters')
      .trim(),
    email: z.string()
      .email('Invalid email format')
      .toLowerCase()
      .trim(),
    password: z.string()
      .min(6, 'Password must be at least 6 characters')
      .max(128, 'Password cannot exceed 128 characters'),
  }),
});

export const loginUserSchema = z.object({
  body: z.object({
    email: z.string()
      .email('Invalid email format')
      .toLowerCase()
      .trim(),
    password: z.string()
      .min(1, 'Password is required'),
  }),
});

export const updateUserSchema = z.object({
  body: z.object({
    name: z.string()
      .min(2, 'Name must be at least 2 characters')
      .max(100, 'Name cannot exceed 100 characters')
      .trim()
      .optional(),
    email: z.string()
      .email('Invalid email format')
      .toLowerCase()
      .trim()
      .optional(),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string()
      .min(6, 'New password must be at least 6 characters')
      .max(128, 'New password cannot exceed 128 characters'),
    confirmPassword: z.string().min(1, 'Password confirmation is required'),
  }),
}).refine((data) => data.body.newPassword === data.body.confirmPassword, {
  message: "Passwords don't match",
  path: ['body', 'confirmPassword'],
});

// Call settings validation schema
export const callSettingsSchema = z.object({
  videoEnabled: z.boolean().default(true),
  audioEnabled: z.boolean().default(true),
  screenShareEnabled: z.boolean().default(true),
  chatEnabled: z.boolean().default(true),
  waitingRoomEnabled: z.boolean().default(false),
  recordingEnabled: z.boolean().default(false),
  backgroundBlurEnabled: z.boolean().default(false),
  noiseReductionEnabled: z.boolean().default(true),
  allowParticipantScreenShare: z.boolean().default(true),
  allowParticipantUnmute: z.boolean().default(true),
  autoAdmitGuests: z.boolean().default(true),
});

// Video call validation schemas
export const createCallSchema = z.object({
  body: z.object({
    title: z.string()
      .min(1, 'Title is required')
      .max(200, 'Title cannot exceed 200 characters')
      .trim(),
    description: z.string()
      .max(1000, 'Description cannot exceed 1000 characters')
      .trim()
      .optional(),
    scheduledAt: z.string()
      .datetime('Invalid date format')
      .refine((date) => new Date(date) > new Date(), 'Scheduled time must be in the future')
      .optional(),
    type: z.nativeEnum(CallType).default(CallType.PUBLIC),
    settings: callSettingsSchema.partial().optional(),
    maxParticipants: z.number()
      .int()
      .min(2, 'Minimum 2 participants required')
      .max(500, 'Maximum 500 participants allowed')
      .default(100),
    passcode: z.string()
      .min(4, 'Passcode must be at least 4 characters')
      .max(20, 'Passcode cannot exceed 20 characters')
      .optional(),
    invitedUserIds: z.array(objectIdSchema).optional(),
  }),
});

export const updateCallSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
  body: z.object({
    title: z.string()
      .min(1, 'Title is required')
      .max(200, 'Title cannot exceed 200 characters')
      .trim()
      .optional(),
    description: z.string()
      .max(1000, 'Description cannot exceed 1000 characters')
      .trim()
      .optional(),
    scheduledAt: z.string()
      .datetime('Invalid date format')
      .refine((date) => new Date(date) > new Date(), 'Scheduled time must be in the future')
      .optional(),
    type: z.nativeEnum(CallType).optional(),
    settings: callSettingsSchema.partial().optional(),
    maxParticipants: z.number()
      .int()
      .min(2, 'Minimum 2 participants required')
      .max(500, 'Maximum 500 participants allowed')
      .optional(),
    passcode: z.string()
      .min(4, 'Passcode must be at least 4 characters')
      .max(20, 'Passcode cannot exceed 20 characters')
      .optional(),
    status: z.nativeEnum(CallStatus).optional(),
  }),
});

export const getCallSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});

export const getCallByRoomIdSchema = z.object({
  params: z.object({
    roomId: z.string().min(1, 'Room ID is required'),
  }),
});

export const deleteCallSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});

export const listCallsSchema = z.object({
  query: paginationSchema.extend({
    status: z.nativeEnum(CallStatus).optional(),
    type: z.nativeEnum(CallType).optional(),
    search: z.string().trim().optional(),
    hostId: objectIdSchema.optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  }),
});

export const joinCallSchema = z.object({
  body: z.object({
    roomId: z.string().min(1, 'Room ID is required'),
    passcode: z.string().optional(),
    guestName: z.string()
      .min(2, 'Guest name must be at least 2 characters')
      .max(100, 'Guest name cannot exceed 100 characters')
      .trim()
      .optional(),
  }),
});

export const addParticipantSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
  body: z.object({
    userId: objectIdSchema,
    role: z.nativeEnum(ParticipantRole).default(ParticipantRole.PARTICIPANT),
  }),
});

export const removeParticipantSchema = z.object({
  params: z.object({
    id: objectIdSchema,
    userId: objectIdSchema,
  }),
});

export const updateParticipantRoleSchema = z.object({
  params: z.object({
    id: objectIdSchema,
    userId: objectIdSchema,
  }),
  body: z.object({
    role: z.nativeEnum(ParticipantRole),
  }),
});

// Token validation schemas
export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});

// Room management schemas (for signaling server)
export const roomJoinSchema = z.object({
  roomId: z.string().min(1, 'Room ID is required'),
  token: z.string().optional(),
  passcode: z.string().optional(),
  guestName: z.string().trim().optional(),
});

export const mediaStateSchema = z.object({
  videoEnabled: z.boolean(),
  audioEnabled: z.boolean(),
  screenShareEnabled: z.boolean(),
});

// WebRTC signaling schemas
export const webrtcOfferSchema = z.object({
  to: z.string().min(1, 'Recipient ID is required'),
  offer: z.object({
    type: z.literal('offer'),
    sdp: z.string().min(1, 'SDP is required'),
  }),
});

export const webrtcAnswerSchema = z.object({
  to: z.string().min(1, 'Recipient ID is required'),
  answer: z.object({
    type: z.literal('answer'),
    sdp: z.string().min(1, 'SDP is required'),
  }),
});

export const webrtcIceCandidateSchema = z.object({
  to: z.string().min(1, 'Recipient ID is required'),
  candidate: z.object({
    candidate: z.string(),
    sdpMLineIndex: z.number().nullable(),
    sdpMid: z.string().nullable(),
  }),
});

// Generic validation middleware
export const validate = (schema: z.ZodType<any>) => {
  return (req: any, res: any, next: any) => {
    try {
      const validatedData = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
        headers: req.headers,
      });

      // Merge validated data back to req
      req.body = validatedData.body || req.body;
      req.query = validatedData.query || req.query;
      req.params = validatedData.params || req.params;

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errorMessages,
        });
      }

      next(error);
    }
  };
};

// Type helpers for validated request objects
export type ValidatedRequest<T extends z.ZodType<any>> = {
  body: z.infer<T>['body'];
  query: z.infer<T>['query'];
  params: z.infer<T>['params'];
  headers: z.infer<T>['headers'];
} & Express.Request;
