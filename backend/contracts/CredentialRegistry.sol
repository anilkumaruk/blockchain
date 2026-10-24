// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title CredentialRegistry
/// @notice Minimal on-chain registry for academic credentials.
///         Only a SHA-256 fingerprint, the issuing address, timestamps and a
///         status flag are stored per credential. Student names, IDs, marks
///         and the certificate file itself never touch the chain.
/// @dev Two issuance modes:
///        - individual: one credential per transaction, indexed by ID and hash
///        - batch: one Merkle root per transaction covering many credentials;
///          each holder keeps a Merkle proof (stored off-chain) to verify
///      Revocation is a state change, never a deletion, so the full
///      issue -> revoke history stays auditable through storage and events.
contract CredentialRegistry is Ownable2Step, Pausable {
    enum Status {
        None,
        Valid,
        Revoked
    }

    struct Credential {
        bytes32 docHash; // SHA-256 of the certificate PDF bytes
        address issuer; // issuing institution's address
        uint64 issuedAt;
        uint64 revokedAt;
        Status status;
    }

    struct Issuer {
        bool active;
        string name;
    }

    struct Batch {
        bytes32 root;
        address issuer;
        uint64 anchoredAt;
        uint32 count;
    }

    mapping(address => Issuer) public issuers;
    // key = keccak256(bytes(credentialId))
    mapping(bytes32 => Credential) private credentials;
    // docHash -> credential key, so a holder of only the file can verify it
    mapping(bytes32 => bytes32) public keyByHash;

    mapping(uint256 => Batch) public batches;
    mapping(bytes32 => bool) public rootUsed;
    // Merkle leaf -> revocation timestamp (0 = not revoked)
    mapping(bytes32 => uint64) public batchLeafRevokedAt;

    uint256 public totalIssued;
    uint256 public totalRevoked;
    uint256 public batchCount;

    event IssuerUpdated(address indexed issuer, string name, bool active);
    event CredentialIssued(bytes32 indexed key, string credentialId, bytes32 docHash, address indexed issuer);
    event CredentialRevoked(bytes32 indexed key, string credentialId, bytes32 reasonHash, address indexed issuer);
    event BatchAnchored(uint256 indexed batchId, bytes32 root, uint32 count, address indexed issuer);

    error NotAuthorizedIssuer();
    error CredentialAlreadyExists();
    error HashAlreadyRegistered();
    error CredentialNotFound();
    error AlreadyRevoked();
    error NotOriginalIssuer();
    error EmptyValue();
    error BatchNotFound();
    error RootAlreadyAnchored();
    error InvalidProof();

    modifier onlyIssuer() {
        if (!issuers[msg.sender].active) revert NotAuthorizedIssuer();
        _;
    }

    constructor(string memory ownerInstitutionName) Ownable(msg.sender) {
        issuers[msg.sender] = Issuer(true, ownerInstitutionName);
        emit IssuerUpdated(msg.sender, ownerInstitutionName, true);
    }

    // ---- governance -------------------------------------------------------

    function setIssuer(address issuer, string calldata name, bool active) external onlyOwner {
        if (issuer == address(0)) revert EmptyValue();
        issuers[issuer] = Issuer(active, name);
        emit IssuerUpdated(issuer, name, active);
    }

    /// @notice Emergency stop: blocks issuance and revocation (e.g. after an
    ///         issuer key compromise). Verification keeps working.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---- individual lifecycle ---------------------------------------------

    function issueCredential(string calldata credentialId, bytes32 docHash) external onlyIssuer whenNotPaused {
        if (bytes(credentialId).length == 0 || docHash == bytes32(0)) revert EmptyValue();
        bytes32 key = keccak256(bytes(credentialId));
        if (credentials[key].status != Status.None) revert CredentialAlreadyExists();
        if (keyByHash[docHash] != bytes32(0)) revert HashAlreadyRegistered();

        credentials[key] = Credential(docHash, msg.sender, uint64(block.timestamp), 0, Status.Valid);
        keyByHash[docHash] = key;
        totalIssued++;

        emit CredentialIssued(key, credentialId, docHash, msg.sender);
    }

    /// @param reasonHash keccak256 of the off-chain revocation reason, so the
    ///        reason text stays private but can be proven later.
    function revokeCredential(string calldata credentialId, bytes32 reasonHash) external onlyIssuer whenNotPaused {
        bytes32 key = keccak256(bytes(credentialId));
        Credential storage c = credentials[key];
        if (c.status == Status.None) revert CredentialNotFound();
        if (c.status == Status.Revoked) revert AlreadyRevoked();
        if (c.issuer != msg.sender) revert NotOriginalIssuer();

        c.status = Status.Revoked;
        c.revokedAt = uint64(block.timestamp);
        totalRevoked++;

        emit CredentialRevoked(key, credentialId, reasonHash, msg.sender);
    }

    // ---- batch lifecycle (Merkle tree) --------------------------------------

    /// @notice Leaf committed to in a batch. Double-hashed so a leaf can never
    ///         be confused with an internal Merkle node (second-preimage safe).
    function leafOf(string calldata credentialId, bytes32 docHash) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(keccak256(bytes(credentialId)), docHash))));
    }

    function anchorBatch(bytes32 root, uint32 count) external onlyIssuer whenNotPaused returns (uint256 batchId) {
        if (root == bytes32(0) || count == 0) revert EmptyValue();
        if (rootUsed[root]) revert RootAlreadyAnchored();
        rootUsed[root] = true;
        batchId = ++batchCount;
        batches[batchId] = Batch(root, msg.sender, uint64(block.timestamp), count);
        totalIssued += count;
        emit BatchAnchored(batchId, root, count, msg.sender);
    }

    function revokeBatchCredential(
        uint256 batchId,
        string calldata credentialId,
        bytes32 docHash,
        bytes32[] calldata proof,
        bytes32 reasonHash
    ) external onlyIssuer whenNotPaused {
        Batch storage b = batches[batchId];
        if (b.root == bytes32(0)) revert BatchNotFound();
        if (b.issuer != msg.sender) revert NotOriginalIssuer();
        bytes32 leaf = leafOf(credentialId, docHash);
        if (!MerkleProof.verifyCalldata(proof, b.root, leaf)) revert InvalidProof();
        if (batchLeafRevokedAt[leaf] != 0) revert AlreadyRevoked();

        batchLeafRevokedAt[leaf] = uint64(block.timestamp);
        totalRevoked++;
        emit CredentialRevoked(keccak256(bytes(credentialId)), credentialId, reasonHash, msg.sender);
    }

    // ---- verification (free, read-only) ------------------------------------

    function getCredential(string calldata credentialId)
        external
        view
        returns (Credential memory credential, bool issuerActive)
    {
        credential = credentials[keccak256(bytes(credentialId))];
        issuerActive = issuers[credential.issuer].active;
    }

    function getCredentialByHash(bytes32 docHash)
        external
        view
        returns (Credential memory credential, bool issuerActive)
    {
        credential = credentials[keyByHash[docHash]];
        issuerActive = issuers[credential.issuer].active;
    }

    /// @notice One-call check: does this exact document match a live credential?
    function verifyCredential(string calldata credentialId, bytes32 docHash)
        external
        view
        returns (bool exists, bool hashMatches, bool revoked, bool issuerActive, address issuer)
    {
        Credential storage c = credentials[keccak256(bytes(credentialId))];
        exists = c.status != Status.None;
        hashMatches = exists && c.docHash == docHash;
        revoked = c.status == Status.Revoked;
        issuer = c.issuer;
        issuerActive = issuers[c.issuer].active;
    }

    /// @notice Verify a batch-issued credential with its Merkle proof.
    function verifyBatchCredential(
        uint256 batchId,
        string calldata credentialId,
        bytes32 docHash,
        bytes32[] calldata proof
    )
        external
        view
        returns (bool included, uint64 revokedAt, bool issuerActive, address issuer, uint64 anchoredAt)
    {
        Batch storage b = batches[batchId];
        if (b.root == bytes32(0)) return (false, 0, false, address(0), 0);
        bytes32 leaf = leafOf(credentialId, docHash);
        included = MerkleProof.verifyCalldata(proof, b.root, leaf);
        revokedAt = batchLeafRevokedAt[leaf];
        issuer = b.issuer;
        issuerActive = issuers[b.issuer].active;
        anchoredAt = b.anchoredAt;
    }
}