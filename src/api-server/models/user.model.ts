import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../../shared/types';

export interface UserDocument extends Omit<User, '_id'>, Document {
  password: string;
  comparePassword(candidatePassword: string): Promise<boolean>;
  generateAvatarUrl(): string;
}

const userSchema = new Schema<UserDocument>({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false // Don't include password in queries by default
  },
  avatar: {
    type: String,
    default: function() {
      return this.generateAvatarUrl();
    }
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret._id = ret._id.toString();
      delete ret.password;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ createdAt: -1 });

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// Method to generate avatar URL using initial
userSchema.methods.generateAvatarUrl = function(): string {
  const initial = this.name ? this.name.charAt(0).toUpperCase() : 'U';
  const colors = ['FF6B6B', '4ECDC4', '45B7D1', '96CEB4', 'FCEA2B', 'FF9FF3', 'F38BA8', 'DDA0DD'];
  const colorIndex = this.email ? this.email.charCodeAt(0) % colors.length : 0;
  const backgroundColor = colors[colorIndex];
  
  return `https://ui-avatars.com/api/?name=${initial}&background=${backgroundColor}&color=fff&size=128&bold=true`;
};

// Static methods
userSchema.statics.findByEmail = function(email: string) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findByIdWithPassword = function(id: string) {
  return this.findById(id).select('+password');
};

export const UserModel = mongoose.model<UserDocument>('User', userSchema);
