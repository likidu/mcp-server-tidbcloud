/**
 * TiDB Cloud API type definitions
 */

// ============================================================================
// Cluster Types
// ============================================================================

/**
 * Cluster state enum
 */
export enum ClusterState {
    CREATING = "CREATING",
    ACTIVE = "ACTIVE",
    PAUSED = "PAUSED",
    RESUMING = "RESUMING",
    MODIFYING = "MODIFYING",
    DELETING = "DELETING",
}

/**
 * Cluster usage information
 */
export interface ClusterUsage {
    requestUnit: string;
    rowBasedStorage: string;
    columnarStorage: string;
}

/**
 * Cluster endpoint connection details
 */
export interface ClusterEndpoints {
    public?: {
        host: string;
        port: number;
        disabled: boolean;
    };
    private?: {
        host: string;
        port: number;
        aws?: {
            serviceName: string;
            availabilityZone: string;
        };
        gcp?: {
            serviceAttachmentName: string;
        };
    };
}

/**
 * Cluster spending limit configuration
 */
export interface SpendingLimit {
    monthly: number;
}

/**
 * Automated backup policy
 */
export interface AutomatedBackupPolicy {
    startTime: string;
    retentionDays: number;
}

/**
 * Cluster resource returned by the API
 */
export interface Cluster {
    clusterId: string;
    displayName: string;
    region: {
        name: string;
        displayName: string;
        provider: string;
    };
    spendingLimit?: SpendingLimit;
    automatedBackupPolicy?: AutomatedBackupPolicy;
    createdAt: string;
    createdBy: string;
    state: ClusterState;
    version: string;
    endpoints?: ClusterEndpoints;
    rootPassword?: string;
    usage?: ClusterUsage;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    userPrefix: string;
}

/**
 * Request body for creating a cluster
 */
export interface CreateClusterRequest {
    displayName: string;
    region: {
        name: string;
    };
    spendingLimit?: SpendingLimit;
    rootPassword?: string;
    labels?: Record<string, string>;
}

/**
 * Request body for updating a cluster
 */
export interface UpdateClusterRequest {
    displayName?: string;
    spendingLimit?: SpendingLimit;
    automatedBackupPolicy?: AutomatedBackupPolicy;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
}

/**
 * Paginated list response for clusters
 */
export interface ListClustersResponse {
    clusters: Cluster[];
    nextPageToken?: string;
    totalSize?: number;
}

// ============================================================================
// Branch Types
// ============================================================================

/**
 * Branch state enum
 */
export enum BranchState {
    CREATING = "CREATING",
    ACTIVE = "ACTIVE",
    DELETED = "DELETED",
    MAINTENANCE = "MAINTENANCE",
    RESTORING = "RESTORING",
}

/**
 * Request body for creating a branch
 */
export interface CreateBranchRequest {
    displayName: string;
    parentId?: string;
    parentTimestamp?: string;
}

/**
 * Branch resource returned by the API
 */
export interface Branch {
    branchId: string;
    clusterId: string;
    displayName: string;
    state: BranchState;
    createdAt: string;
    parentId: string;
    createdBy?: string;
    endpoints?: BranchEndpoint;
}

/**
 * Branch endpoint connection details
 */
export interface BranchEndpoint {
    public?: {
        host: string;
        port: number;
    };
    private?: {
        host: string;
        port: number;
        aws?: {
            serviceName: string;
            availabilityZone: string;
        };
    };
}

/**
 * Paginated list response for branches
 */
export interface ListBranchesResponse {
    branches: Branch[];
    nextPageToken?: string;
    totalSize?: number;
}

// ============================================================================
// Common Types
// ============================================================================

/**
 * API error response
 */
export interface ApiError {
    code: string;
    message: string;
    details?: Array<{
        "@type": string;
        [key: string]: unknown;
    }>;
}

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
    data?: T;
    error?: ApiError;
}

// ============================================================================
// Region Types
// ============================================================================

/**
 * Region information
 */
export interface Region {
    name: string;
    displayName: string;
    provider: string;
}

/**
 * List regions response
 */
export interface ListRegionsResponse {
    regions: Region[];
}
