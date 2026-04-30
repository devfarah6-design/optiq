#!/usr/bin/env python3
"""
Standalone XGBoost Model Tester
Run: python test_xgb_model.py
"""

import pickle
import numpy as np
import pandas as pd

# Load your model
print("Loading model...")
with open('best_xgb_model.pkl', 'rb') as f:
    model_data = pickle.load(f)

# Check what type of object was saved
print(f"\n📦 Model type: {type(model_data)}")

# If it's a dict (common with multiple objects)
if isinstance(model_data, dict):
    print(f"Keys in model file: {list(model_data.keys())}")
    model = model_data.get('model', model_data.get('xgb_model', model_data))
    scaler = model_data.get('scaler', None)
    feature_names = model_data.get('feature_names', None)
    print(f"Model class: {type(model)}")
else:
    model = model_data
    scaler = None
    feature_names = None

# If it's a standard XGBoost model
try:
    import xgboost as xgb
    print(f"\n✅ XGBoost version: {xgb.__version__}")
    
    # Try to get feature names from model
    if hasattr(model, 'get_booster'):
        booster = model.get_booster()
        if hasattr(booster, 'feature_names'):
            feature_names = booster.feature_names
            print(f"Feature names from model: {feature_names[:5]}... ({len(feature_names)} total)")
except ImportError:
    print("⚠️ XGBoost not installed. Install with: pip install xgboost")

# Create test inputs
print("\n" + "="*60)
print("TESTING MODEL WITH DIFFERENT INPUTS")
print("="*60)

# Define realistic test cases for debutanizer
test_cases = [
    {
        'name': 'Nominal operating point',
        'features': {
            '2FI422.PV': 3000.0,      # Steam flow
            '2TI1_414.PV': 74.0,      # Reflux temp
            '2TIC403.PV': 94.0,       # Bottom temp
            '2FI431.PV': 12.0,        # Reflux flow
            '2LIC409.PV': 52.0,       # Level
            '2PIC409.PV': 6.2,        # Pressure
            'FI_FEED.PV': 40.0,       # Feed flow
            'TI_FEED.PV': 55.0,       # Feed temp
            # Add other features with nominal values...
        }
    },
    {
        'name': 'Low energy mode',
        'features': {
            '2FI422.PV': 2600.0,      # Lower steam
            '2TI1_414.PV': 76.0,      # Higher reflux
            '2TIC403.PV': 92.0,       # Lower bottom
            '2FI431.PV': 10.0,
            '2LIC409.PV': 50.0,
            '2PIC409.PV': 6.0,
            'FI_FEED.PV': 40.0,
            'TI_FEED.PV': 55.0,
        }
    },
    {
        'name': 'High purity mode',
        'features': {
            '2FI422.PV': 3300.0,      # Higher steam
            '2TI1_414.PV': 72.0,      # Lower reflux
            '2TIC403.PV': 96.0,       # Higher bottom
            '2FI431.PV': 14.0,
            '2LIC409.PV': 54.0,
            '2PIC409.PV': 6.5,
            'FI_FEED.PV': 40.0,
            'TI_FEED.PV': 55.0,
        }
    }
]

# Function to predict with proper input format
def predict_with_model(model, features_dict, scaler=None):
    """Predict energy and purity from features"""
    
    # Convert dict to array in correct order
    # You need to know the feature order from training!
    # This is a simplified example
    
    # If you have feature_names from training
    if feature_names:
        # Create array in the exact order the model expects
        feature_array = []
        for fname in feature_names:
            if fname in features_dict:
                feature_array.append(features_dict[fname])
            else:
                # Use default value if missing
                feature_array.append(0.0)
        X = np.array([feature_array])
    else:
        # Just use the values from dict in alphabetical order
        feature_array = [features_dict.get(k, 0.0) for k in sorted(features_dict.keys())]
        X = np.array([feature_array])
    
    # Apply scaler if present
    if scaler:
        X = scaler.transform(X)
    
    # Predict (adjust based on your model's output)
    prediction = model.predict(X)
    
    # If model predicts both energy and purity
    if isinstance(prediction, np.ndarray):
        if prediction.ndim == 2 and prediction.shape[1] == 2:
            energy = prediction[0, 0]
            purity = prediction[0, 1]
        elif prediction.ndim == 1 and len(prediction) == 2:
            energy = prediction[0]
            purity = prediction[1]
        else:
            # Single output - you need to determine which
            energy = prediction[0]
            purity = None
    else:
        energy = prediction
        purity = None
    
    return energy, purity

# Run tests
for test in test_cases:
    print(f"\n📊 {test['name']}:")
    print(f"   Steam: {test['features'].get('2FI422.PV', 'N/A')} kg/h")
    print(f"   Reflux: {test['features'].get('2TI1_414.PV', 'N/A')} °C")
    print(f"   Bottom: {test['features'].get('2TIC403.PV', 'N/A')} °C")
    
    try:
        energy, purity = predict_with_model(model, test['features'], scaler)
        if purity:
            print(f"   📈 Energy: {energy:.4f} | Purity: {purity:.2f}%")
        else:
            print(f"   📈 Energy: {energy:.4f}")
    except Exception as e:
        print(f"   ❌ Error: {e}")

# Sensitivity test
print("\n" + "="*60)
print("SENSITIVITY TEST")
print("="*60)

# Create base features
base_features = test_cases[0]['features'].copy()

# Test steam sensitivity
print("\n🔄 Varying Steam Flow (2600-3400 kg/h):")
steam_values = np.linspace(2600, 3400, 5)
for steam in steam_values:
    base_features['2FI422.PV'] = steam
    try:
        energy, purity = predict_with_model(model, base_features, scaler)
        if purity:
            print(f"   Steam={steam:.0f} → Energy={energy:.4f}, Purity={purity:.2f}%")
        else:
            print(f"   Steam={steam:.0f} → Energy={energy:.4f}")
    except Exception as e:
        print(f"   Error at {steam}: {e}")

# Test reflux sensitivity
print("\n🔄 Varying Reflux Temperature (68-80°C):")
reflux_values = np.linspace(68, 80, 5)
base_features = test_cases[0]['features'].copy()
for reflux in reflux_values:
    base_features['2TI1_414.PV'] = reflux
    try:
        energy, purity = predict_with_model(model, base_features, scaler)
        if purity:
            print(f"   Reflux={reflux:.1f} → Energy={energy:.4f}, Purity={purity:.2f}%")
        else:
            print(f"   Reflux={reflux:.1f} → Energy={energy:.4f}")
    except Exception as e:
        print(f"   Error at {reflux}: {e}")

# Test bottom sensitivity
print("\n🔄 Varying Bottom Temperature (88-100°C):")
bottom_values = np.linspace(88, 100, 5)
base_features = test_cases[0]['features'].copy()
for bottom in bottom_values:
    base_features['2TIC403.PV'] = bottom
    try:
        energy, purity = predict_with_model(model, base_features, scaler)
        if purity:
            print(f"   Bottom={bottom:.1f} → Energy={energy:.4f}, Purity={purity:.2f}%")
        else:
            print(f"   Bottom={bottom:.1f} → Energy={energy:.4f}")
    except Exception as e:
        print(f"   Error at {bottom}: {e}")