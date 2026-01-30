"""
Medical Procedures Database
Handles loading and storing medical procedure data with embeddings
"""
import pickle
import numpy as np
from pathlib import Path
from sentence_transformers import SentenceTransformer

class MedicalDatabase:
    def __init__(self, config):
        """Initialize database with configuration"""
        self.config = config
        self.procedures = []
        self.embeddings = None
        self.embedding_model = None
    
    def load(self, cache_dir):
        """Load database from cache directory"""
        cache_path = Path(cache_dir)
        
        # Load procedures
        with open(cache_path / 'procedures.pkl', 'rb') as f:
            self.procedures = pickle.load(f)
        
        # Load embeddings
        with open(cache_path / 'embeddings.npy', 'rb') as f:
            self.embeddings = np.load(f)
        
        # Load embedding model
        print("Loading embedding model (this may take a moment)...")
        model_name = self.config['database']['embedding_model']
        self.embedding_model = SentenceTransformer(model_name)
        
        print(f"Loaded database from {cache_dir}")
        print(f"  - {len(self.procedures)} procedures")
