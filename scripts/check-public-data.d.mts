export interface PublicDataViolation {
  file: string;
  line: number;
  rule: string;
}

export declare const PUBLIC_DATA_DIRS: string[];
export declare const PUBLIC_DOC_DIRS: string[];
export declare const PUBLIC_ROOT_FILES: string[];
export declare function scanPublicData(root: string): PublicDataViolation[];
